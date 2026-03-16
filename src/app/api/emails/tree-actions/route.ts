import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { trashEmails, archiveEmails, markAsReadBulk, markAsUnreadBulk, starEmails, unstarEmails } from '@/lib/gmail/client';
import { DIMENSIONS } from '@/lib/grouping/engine';
import { partitionByGmailId, buildActionResult } from '@/lib/email-utils';
import type { GmailAccount, DimensionKey, TreeActionRequest } from '@/types';
import { CATEGORIES } from '@/types';

// --- Dimension sets for filter resolution (mirrors /api/emails logic) ---
const CATEGORY_DIMENSIONS = new Set<DimensionKey>(['category', 'topic', 'importance']);
const DATE_DIMENSIONS = new Set<DimensionKey>(['date_month', 'date_week']);

// Map dimension keys to their actual column names in email_categories.
const CATEGORY_COLUMN_MAP: Partial<Record<DimensionKey, string>> = {
  category: 'category',
  topic: 'topic',
  importance: 'importance_label',
};

/**
 * Generalized bulk actions on any set of tree-filtered emails.
 * Accepts arbitrary filter paths (not just category) so every tree level
 * can offer trash/archive/mark_read/mark_unread/reassign.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as TreeActionRequest & { emailIds?: string[] };
  const { action, filters, newCategory, configId, emailIds } = body;

  // --- Validate inputs ---
  const validActions = ['trash', 'archive', 'mark_read', 'mark_unread', 'reassign', 'star', 'unstar'] as const;
  if (!action || !(validActions as readonly string[]).includes(action)) {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  }

  // Accept either emailIds (for bulk list actions) or filters (for tree actions)
  const useDirectIds = Array.isArray(emailIds) && emailIds.length > 0;
  if (!useDirectIds && (!filters || !Array.isArray(filters) || filters.length === 0)) {
    return NextResponse.json({ error: 'Either emailIds or filters is required' }, { status: 400 });
  }

  // Validate each filter dimension exists (only when using filters)
  if (!useDirectIds && filters) {
    for (const f of filters) {
      if (!DIMENSIONS[f.dimension]) {
        return NextResponse.json({ error: `Unknown dimension: ${f.dimension}` }, { status: 400 });
      }
    }
  }

  if (action === 'reassign' && !newCategory) {
    return NextResponse.json({ error: 'Missing newCategory for reassign' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  if (action === 'reassign' && newCategory) {
    // Validate against user's custom categories, falling back to defaults
    const { data: userCategories } = await serviceClient
      .from('user_categories')
      .select('name')
      .eq('user_id', user.id);
    const validNames = userCategories && userCategories.length > 0
      ? userCategories.map((c) => c.name)
      : [...CATEGORIES];
    if (!validNames.includes(newCategory)) {
      return NextResponse.json({ error: 'Invalid target category' }, { status: 400 });
    }
  }

  // Get user's Gmail accounts (multi-inbox)
  const { data: allAccounts } = await serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('user_id', user.id);

  if (!allAccounts || allAccounts.length === 0) {
    return NextResponse.json({ error: 'No Gmail account' }, { status: 404 });
  }

  const allAccountIds = allAccounts.map((a) => a.id);

  // Build account lookup map for multi-inbox Gmail API calls
  const accountMap = new Map<string, GmailAccount>();
  for (const a of allAccounts) {
    accountMap.set(a.id, a as GmailAccount);
  }

  // --- Resolve to email rows ---
  // When emailIds provided directly (bulk list actions), skip filter resolution
  if (useDirectIds) {
    return handleDirectIds(emailIds!, action as string, newCategory, allAccountIds, accountMap, serviceClient);
  }

  // Same logic as /api/emails: use Supabase for email-table filters, JS for category/date
  const needsCategories =
    filters!.some((f) => CATEGORY_DIMENSIONS.has(f.dimension)) ||
    action === 'reassign';

  const selectFields = needsCategories
    ? 'id, gmail_message_id, gmail_account_id, label_ids, is_read, sender_email, sender_domain, has_attachment, received_at, email_categories(*)'
    : 'id, gmail_message_id, gmail_account_id, label_ids, is_read, sender_email, sender_domain, has_attachment, received_at';

  let query = serviceClient
    .from('emails')
    .select(selectFields)
    .in('gmail_account_id', allAccountIds);

  // Apply date range from config if provided — try view_configs first, fall back to grouping_configs
  if (configId) {
    const { data: vcConfig } = await serviceClient
      .from('view_configs')
      .select('date_range_start, date_range_end')
      .eq('id', configId)
      .eq('user_id', user.id)
      .maybeSingle();
    const config = vcConfig ?? (await serviceClient
      .from('grouping_configs')
      .select('date_range_start, date_range_end')
      .eq('id', configId)
      .eq('user_id', user.id)
      .maybeSingle()).data;
    if (config) {
      if (config.date_range_start) {
        query = query.gte('received_at', config.date_range_start as string);
      }
      if (config.date_range_end) {
        query = query.lte('received_at', config.date_range_end as string);
      }
    }
  }

  // Apply email-table filters via query builder (fast DB-side filtering)
  for (const filter of filters) {
    if (!CATEGORY_DIMENSIONS.has(filter.dimension) && !DATE_DIMENSIONS.has(filter.dimension)) {
      const col = getEmailColumn(filter.dimension);
      if (col) {
        if (filter.dimension === 'is_read' || filter.dimension === 'has_attachment') {
          query = query.eq(col, filter.value === 'true');
        } else {
          query = query.eq(col, filter.value);
        }
      }
    }
  }

  const { data: rawRows, error: fetchError } = await query;

  if (fetchError) {
    console.error('[tree-action] Query failed:', fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!rawRows || rawRows.length === 0) {
    return NextResponse.json({ success: true, affected: 0 });
  }

  // --- Apply JS-side filters for category & date dimensions ---
  type RowWithCat = Record<string, unknown> & {
    email_categories?: Record<string, unknown> | Record<string, unknown>[] | null;
  };
  let rows = rawRows as unknown as RowWithCat[];

  for (const filter of filters) {
    if (CATEGORY_DIMENSIONS.has(filter.dimension)) {
      const col = CATEGORY_COLUMN_MAP[filter.dimension] ?? filter.dimension;
      rows = rows.filter((row) => {
        const cat = getCategory(row.email_categories);
        return cat != null && cat[col] === filter.value;
      });
    } else if (DATE_DIMENSIONS.has(filter.dimension)) {
      rows = rows.filter((row) => {
        const key = formatDateDimension(row.received_at as string, filter.dimension);
        return key === filter.value;
      });
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ success: true, affected: 0 });
  }

  // Filter out rows with null/missing gmail_message_id to prevent batch API failures
  const { valid: gmailRows, invalid: skippedRows } = partitionByGmailId(
    rows as (RowWithCat & { gmail_message_id: unknown })[]
  );
  if (skippedRows.length > 0) {
    console.warn(`[tree-action] Skipped ${skippedRows.length} emails with missing gmail_message_id`);
  }

  if (gmailRows.length === 0) {
    return NextResponse.json({ success: true, affected: 0, skipped: skippedRows.length });
  }

  // --- Group emails by gmail_account_id for per-account Gmail API calls ---
  const emailsByAccount = new Map<string, typeof gmailRows>();
  for (const row of gmailRows) {
    const acctId = row.gmail_account_id as string;
    const list = emailsByAccount.get(acctId);
    if (list) {
      list.push(row);
    } else {
      emailsByAccount.set(acctId, [row]);
    }
  }

  // --- Execute action ---
  try {
    switch (action) {
      case 'trash': {
        let totalTrashed = 0;
        let totalFailed = 0;
        for (const [acctId, acctRows] of emailsByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') {
            totalFailed += acctRows.length;
            continue;
          }
          const acctGmailIds = acctRows.map((r) => r.gmail_message_id as string);
          const result = await trashEmails(acct, acctGmailIds);
          totalTrashed += result.trashed;
          totalFailed += result.failed;
        }
        // Soft-delete: update labels (remove INBOX, add TRASH) instead of deleting from DB
        const trashDbResults = await Promise.allSettled(
          gmailRows.map((e) => {
            const currentLabels = ((e.label_ids as string[]) ?? []).filter((l: string) => l !== 'INBOX');
            if (!currentLabels.includes('TRASH')) currentLabels.push('TRASH');
            return serviceClient
              .from('emails')
              .update({ label_ids: currentLabels })
              .eq('id', e.id as string);
          })
        );
        const trashDbFailed = trashDbResults.filter(
          (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error)
        ).length;
        if (trashDbFailed > 0) {
          console.error(`[tree-action] ${trashDbFailed} DB label updates failed during trash`);
        }
        const trashActionResult = buildActionResult(
          'trash',
          { affected: totalTrashed, failed: totalFailed },
          trashDbFailed > 0 ? `${trashDbFailed} DB label updates failed` : null,
        );
        return NextResponse.json(trashActionResult.body, { status: trashActionResult.status });
      }

      case 'archive': {
        let totalArchived = 0;
        let totalFailed = 0;
        for (const [acctId, acctRows] of emailsByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') {
            totalFailed += acctRows.length;
            continue;
          }
          const acctGmailIds = acctRows.map((r) => r.gmail_message_id as string);
          const result = await archiveEmails(acct, acctGmailIds);
          totalArchived += result.archived;
          totalFailed += result.failed;
        }
        // Update label_ids: remove INBOX for each email
        const archiveDbResults = await Promise.allSettled(
          gmailRows.map((e) => {
            const currentLabels = (e.label_ids as string[]) ?? [];
            const newLabels = currentLabels.filter((l: string) => l !== 'INBOX');
            return serviceClient
              .from('emails')
              .update({ label_ids: newLabels })
              .eq('id', e.id as string);
          })
        );
        // Supabase client never throws — check both rejected promises and fulfilled-with-error
        const archiveDbFailed = archiveDbResults.filter(
          (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error)
        ).length;
        if (archiveDbFailed > 0) {
          console.error(`[tree-action] ${archiveDbFailed} DB label updates failed during archive`);
        }
        const archiveActionResult = buildActionResult(
          'archive',
          { affected: totalArchived, failed: totalFailed },
          archiveDbFailed > 0 ? `${archiveDbFailed} DB label updates failed` : null,
        );
        return NextResponse.json(archiveActionResult.body, { status: archiveActionResult.status });
      }

      case 'mark_read': {
        // Only modify unread emails
        const unreadRows = gmailRows.filter((r) => r.is_read === false);
        if (unreadRows.length === 0) {
          return NextResponse.json({ success: true, action: 'mark_read', affected: 0 });
        }
        let totalUpdated = 0;
        let totalFailed = 0;
        // Group unread rows by account for per-account API calls
        const unreadByAccount = new Map<string, typeof unreadRows>();
        for (const row of unreadRows) {
          const acctId = row.gmail_account_id as string;
          const list = unreadByAccount.get(acctId);
          if (list) list.push(row);
          else unreadByAccount.set(acctId, [row]);
        }
        for (const [acctId, acctRows] of unreadByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') {
            totalFailed += acctRows.length;
            continue;
          }
          const result = await markAsReadBulk(acct, acctRows.map((r) => r.gmail_message_id as string));
          totalUpdated += result.updated;
          totalFailed += result.failed;
        }
        const unreadDbIds = unreadRows.map((r) => r.id as string);
        const { error: readErr } = await serviceClient
          .from('emails')
          .update({ is_read: true })
          .in('id', unreadDbIds);
        if (readErr) console.error('[tree-action] DB update is_read failed:', readErr);
        const readActionResult = buildActionResult(
          'mark_read',
          { affected: totalUpdated, failed: totalFailed },
          readErr ? readErr.message : null,
        );
        return NextResponse.json(readActionResult.body, { status: readActionResult.status });
      }

      case 'mark_unread': {
        // Only modify read emails
        const readRows = gmailRows.filter((r) => r.is_read === true);
        if (readRows.length === 0) {
          return NextResponse.json({ success: true, action: 'mark_unread', affected: 0 });
        }
        let totalUpdated = 0;
        let totalFailed = 0;
        // Group read rows by account for per-account API calls
        const readByAccount = new Map<string, typeof readRows>();
        for (const row of readRows) {
          const acctId = row.gmail_account_id as string;
          const list = readByAccount.get(acctId);
          if (list) list.push(row);
          else readByAccount.set(acctId, [row]);
        }
        for (const [acctId, acctRows] of readByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') {
            totalFailed += acctRows.length;
            continue;
          }
          const result = await markAsUnreadBulk(acct, acctRows.map((r) => r.gmail_message_id as string));
          totalUpdated += result.updated;
          totalFailed += result.failed;
        }
        const readDbIds = readRows.map((r) => r.id as string);
        const { error: unreadErr } = await serviceClient
          .from('emails')
          .update({ is_read: false })
          .in('id', readDbIds);
        if (unreadErr) console.error('[tree-action] DB update is_read failed:', unreadErr);
        const unreadActionResult = buildActionResult(
          'mark_unread',
          { affected: totalUpdated, failed: totalFailed },
          unreadErr ? unreadErr.message : null,
        );
        return NextResponse.json(unreadActionResult.body, { status: unreadActionResult.status });
      }

      case 'reassign': {
        // Split into already-categorized vs uncategorized emails
        const categorizedIds: string[] = [];
        const uncategorizedIds: string[] = [];
        for (const r of rows) {
          if (getCategory(r.email_categories) != null) {
            categorizedIds.push(r.id as string);
          } else {
            uncategorizedIds.push(r.id as string);
          }
        }

        if (categorizedIds.length === 0 && uncategorizedIds.length === 0) {
          return NextResponse.json({ success: true, action: 'reassign', affected: 0 });
        }

        const now = new Date().toISOString();

        // Update existing email_categories rows
        if (categorizedIds.length > 0) {
          const { error: updateError } = await serviceClient
            .from('email_categories')
            .update({
              category: newCategory,
              confidence: 1.0,
              categorized_at: now,
            })
            .in('email_id', categorizedIds);

          if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
          }
        }

        // Insert email_categories rows for uncategorized emails
        if (uncategorizedIds.length > 0) {
          const newRows = uncategorizedIds.map((id) => ({
            email_id: id,
            category: newCategory,
            confidence: 1.0,
            categorized_at: now,
          }));
          const { error: insertError } = await serviceClient
            .from('email_categories')
            .upsert(newRows, { onConflict: 'email_id' });

          if (insertError) {
            console.error('[tree-action] Failed to insert categories for uncategorized emails:', insertError);
          } else {
            // Mark newly categorized emails
            await serviceClient
              .from('emails')
              .update({ is_categorized: true, categorization_status: 'done' })
              .in('id', uncategorizedIds);
          }
        }

        return NextResponse.json({
          success: true,
          action: 'reassign',
          affected: categorizedIds.length + uncategorizedIds.length,
          newCategory,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[tree-action] ${action} failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 }
    );
  }
}

/**
 * Fast path for bulk actions from the email list — IDs are already known.
 * Fetches emails by ID (scoped to user's accounts), then executes the action
 * with per-account Gmail API calls.
 */
async function handleDirectIds(
  emailIds: string[],
  action: string,
  newCategory: string | undefined,
  allAccountIds: string[],
  accountMap: Map<string, GmailAccount>,
  serviceClient: ReturnType<typeof createServiceClient>,
) {
  // Bug 1 fix: scope query to user's accounts to prevent cross-user access
  const { data: rawRows, error } = await serviceClient
    .from('emails')
    .select('id, gmail_message_id, gmail_account_id, label_ids, is_read, is_starred')
    .in('id', emailIds)
    .in('gmail_account_id', allAccountIds);

  if (error || !rawRows || rawRows.length === 0) {
    return NextResponse.json({ success: true, affected: 0 });
  }

  type Row = { id: string; gmail_message_id: string | null; gmail_account_id: string; label_ids: string[] | null; is_read: boolean; is_starred: boolean };
  const { valid: rows, invalid: skipped } = partitionByGmailId(rawRows as unknown as Row[]);
  if (rows.length === 0) {
    return NextResponse.json({ success: true, affected: 0, skipped: skipped.length });
  }

  const dbIds = rows.map((r) => r.id as string);

  // Bug 2 fix: group emails by account for per-account Gmail API calls
  const rowsByAccount = new Map<string, Row[]>();
  for (const row of rows as unknown as Row[]) {
    const list = rowsByAccount.get(row.gmail_account_id);
    if (list) list.push(row);
    else rowsByAccount.set(row.gmail_account_id, [row]);
  }

  try {
    switch (action) {
      case 'trash': {
        let totalTrashed = 0;
        let totalFailed = 0;
        for (const [acctId, acctRows] of rowsByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') { totalFailed += acctRows.length; continue; }
          const result = await trashEmails(acct, acctRows.map((r) => r.gmail_message_id!));
          totalTrashed += result.trashed;
          totalFailed += result.failed;
        }
        await Promise.allSettled(
          (rows as unknown as Row[]).map((e) => {
            const labels = (e.label_ids ?? []).filter((l) => l !== 'INBOX');
            if (!labels.includes('TRASH')) labels.push('TRASH');
            return serviceClient.from('emails').update({ label_ids: labels }).eq('id', e.id);
          })
        );
        return NextResponse.json(buildActionResult('trash', { affected: totalTrashed, failed: totalFailed }, null).body);
      }
      case 'archive': {
        let totalArchived = 0;
        let totalFailed = 0;
        for (const [acctId, acctRows] of rowsByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') { totalFailed += acctRows.length; continue; }
          const result = await archiveEmails(acct, acctRows.map((r) => r.gmail_message_id!));
          totalArchived += result.archived;
          totalFailed += result.failed;
        }
        await Promise.allSettled(
          (rows as unknown as Row[]).map((e) => {
            const labels = (e.label_ids ?? []).filter((l) => l !== 'INBOX');
            return serviceClient.from('emails').update({ label_ids: labels }).eq('id', e.id);
          })
        );
        return NextResponse.json(buildActionResult('archive', { affected: totalArchived, failed: totalFailed }, null).body);
      }
      case 'star': {
        let totalStarred = 0;
        let totalFailed = 0;
        for (const [acctId, acctRows] of rowsByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') { totalFailed += acctRows.length; continue; }
          const result = await starEmails(acct, acctRows.map((r) => r.gmail_message_id!));
          totalStarred += result.starred;
          totalFailed += result.failed;
        }
        await serviceClient.from('emails').update({ is_starred: true }).in('id', dbIds);
        return NextResponse.json(buildActionResult('star', { affected: totalStarred, failed: totalFailed }, null).body);
      }
      case 'unstar': {
        let totalUnstarred = 0;
        let totalFailed = 0;
        for (const [acctId, acctRows] of rowsByAccount) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') { totalFailed += acctRows.length; continue; }
          const result = await unstarEmails(acct, acctRows.map((r) => r.gmail_message_id!));
          totalUnstarred += result.unstarred;
          totalFailed += result.failed;
        }
        await serviceClient.from('emails').update({ is_starred: false }).in('id', dbIds);
        return NextResponse.json(buildActionResult('unstar', { affected: totalUnstarred, failed: totalFailed }, null).body);
      }
      case 'mark_read': {
        const unread = (rows as unknown as Row[]).filter((r) => r.is_read === false);
        if (unread.length === 0) return NextResponse.json({ success: true, affected: 0 });
        let totalUpdated = 0;
        let totalFailed = 0;
        const unreadByAcct = new Map<string, Row[]>();
        for (const r of unread) {
          const list = unreadByAcct.get(r.gmail_account_id);
          if (list) list.push(r);
          else unreadByAcct.set(r.gmail_account_id, [r]);
        }
        for (const [acctId, acctRows] of unreadByAcct) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') { totalFailed += acctRows.length; continue; }
          const result = await markAsReadBulk(acct, acctRows.map((r) => r.gmail_message_id!));
          totalUpdated += result.updated;
          totalFailed += result.failed;
        }
        await serviceClient.from('emails').update({ is_read: true }).in('id', unread.map((r) => r.id));
        return NextResponse.json(buildActionResult('mark_read', { affected: totalUpdated, failed: totalFailed }, null).body);
      }
      case 'mark_unread': {
        const read = (rows as unknown as Row[]).filter((r) => r.is_read === true);
        if (read.length === 0) return NextResponse.json({ success: true, affected: 0 });
        let totalUpdated = 0;
        let totalFailed = 0;
        const readByAcct = new Map<string, Row[]>();
        for (const r of read) {
          const list = readByAcct.get(r.gmail_account_id);
          if (list) list.push(r);
          else readByAcct.set(r.gmail_account_id, [r]);
        }
        for (const [acctId, acctRows] of readByAcct) {
          const acct = accountMap.get(acctId);
          if (!acct || acct.granted_scope !== 'gmail.modify') { totalFailed += acctRows.length; continue; }
          const result = await markAsUnreadBulk(acct, acctRows.map((r) => r.gmail_message_id!));
          totalUpdated += result.updated;
          totalFailed += result.failed;
        }
        await serviceClient.from('emails').update({ is_read: false }).in('id', read.map((r) => r.id));
        return NextResponse.json(buildActionResult('mark_unread', { affected: totalUpdated, failed: totalFailed }, null).body);
      }
      default:
        return NextResponse.json({ error: `Unsupported bulk action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[tree-action/direct] ${action} failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 }
    );
  }
}

// --- Helpers (same as /api/emails/route.ts) ---

function getCategory(
  emailCategories: Record<string, unknown> | Record<string, unknown>[] | null | undefined,
): Record<string, unknown> | null {
  if (emailCategories == null) return null;
  if (Array.isArray(emailCategories)) return emailCategories[0] ?? null;
  return emailCategories;
}

function getEmailColumn(dimension: DimensionKey): string | null {
  const map: Partial<Record<DimensionKey, string>> = {
    sender: 'sender_email',
    sender_domain: 'sender_domain',
    is_read: 'is_read',
    has_attachment: 'has_attachment',
  };
  return map[dimension] ?? null;
}

function formatDateDimension(dateStr: string, dimension: DimensionKey): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  if (dimension === 'date_month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  if (dimension === 'date_week') {
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  return null;
}
