import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { trashEmails, archiveEmails, markAsReadBulk, markAsUnreadBulk } from '@/lib/gmail/client';
import { DIMENSIONS } from '@/lib/grouping/engine';
import type { GmailAccount, DimensionKey, TreeActionRequest } from '@/types';
import { CATEGORIES } from '@/types';

// --- Dimension sets for filter resolution (mirrors /api/emails logic) ---
const CATEGORY_DIMENSIONS = new Set<DimensionKey>(['category', 'topic', 'priority']);
const DATE_DIMENSIONS = new Set<DimensionKey>(['date_month', 'date_week']);

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

  const body = (await request.json()) as TreeActionRequest;
  const { action, filters, newCategory, configId } = body;

  // --- Validate inputs ---
  const validActions = ['trash', 'archive', 'mark_read', 'mark_unread', 'reassign'] as const;
  if (!action || !(validActions as readonly string[]).includes(action)) {
    return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  }

  if (!filters || !Array.isArray(filters) || filters.length === 0) {
    return NextResponse.json({ error: 'At least one filter is required' }, { status: 400 });
  }

  // Validate each filter dimension exists
  for (const f of filters) {
    if (!DIMENSIONS[f.dimension]) {
      return NextResponse.json({ error: `Unknown dimension: ${f.dimension}` }, { status: 400 });
    }
  }

  if (action === 'reassign' && !newCategory) {
    return NextResponse.json({ error: 'Missing newCategory for reassign' }, { status: 400 });
  }
  if (action === 'reassign' && newCategory && !(CATEGORIES as readonly string[]).includes(newCategory)) {
    return NextResponse.json({ error: 'Invalid target category' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Get user's Gmail account
  const { data: account } = await serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!account) {
    return NextResponse.json({ error: 'No Gmail account' }, { status: 404 });
  }

  const gmailAccount = account as GmailAccount;

  // --- Resolve filters to email IDs ---
  // Same logic as /api/emails: use Supabase for email-table filters, JS for category/date
  const needsCategories =
    filters.some((f) => CATEGORY_DIMENSIONS.has(f.dimension)) ||
    action === 'reassign';

  const selectFields = needsCategories
    ? 'id, gmail_message_id, label_ids, is_read, sender_email, sender_domain, has_attachment, received_at, email_categories(category, topic, priority)'
    : 'id, gmail_message_id, label_ids, is_read, sender_email, sender_domain, has_attachment, received_at';

  let query = serviceClient
    .from('emails')
    .select(selectFields)
    .eq('gmail_account_id', gmailAccount.id);

  // Apply date range from config if provided
  if (configId) {
    const { data: config } = await serviceClient
      .from('grouping_configs')
      .select('date_range_start, date_range_end')
      .eq('id', configId)
      .eq('user_id', user.id)
      .limit(1)
      .single();
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
      rows = rows.filter((row) => {
        const cat = getCategory(row.email_categories);
        return cat != null && cat[filter.dimension] === filter.value;
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

  const emailIds = rows.map((r) => r.id as string);
  const gmailMessageIds = rows.map((r) => r.gmail_message_id as string);

  // --- Execute action ---
  try {
    switch (action) {
      case 'trash': {
        if (gmailAccount.granted_scope !== 'gmail.modify') {
          return NextResponse.json({ error: 'Gmail modify scope required' }, { status: 403 });
        }
        const trashResult = await trashEmails(gmailAccount, gmailMessageIds);
        const { error: deleteError } = await serviceClient
          .from('emails')
          .delete()
          .in('id', emailIds);
        if (deleteError) {
          console.error('[tree-action] DB delete failed:', deleteError);
        }
        return NextResponse.json({
          success: true,
          action: 'trash',
          affected: trashResult.trashed,
          failed: trashResult.failed,
        });
      }

      case 'archive': {
        if (gmailAccount.granted_scope !== 'gmail.modify') {
          return NextResponse.json({ error: 'Gmail modify scope required' }, { status: 403 });
        }
        const archiveResult = await archiveEmails(gmailAccount, gmailMessageIds);
        // Update label_ids: remove INBOX for each email
        const archiveDbResults = await Promise.allSettled(
          rows.map((e) => {
            const currentLabels = (e.label_ids as string[]) ?? [];
            const newLabels = currentLabels.filter((l: string) => l !== 'INBOX');
            return serviceClient
              .from('emails')
              .update({ label_ids: newLabels })
              .eq('id', e.id as string);
          })
        );
        const archiveDbFailed = archiveDbResults.filter((r) => r.status === 'rejected').length;
        if (archiveDbFailed > 0) {
          console.error(`[tree-action] ${archiveDbFailed} DB label updates failed during archive`);
        }
        return NextResponse.json({
          success: true,
          action: 'archive',
          affected: archiveResult.archived,
          failed: archiveResult.failed,
        });
      }

      case 'mark_read': {
        if (gmailAccount.granted_scope !== 'gmail.modify') {
          return NextResponse.json({ error: 'Gmail modify scope required' }, { status: 403 });
        }
        // Only modify unread emails
        const unreadRows = rows.filter((r) => r.is_read === false);
        if (unreadRows.length === 0) {
          return NextResponse.json({ success: true, action: 'mark_read', affected: 0 });
        }
        const unreadGmailIds = unreadRows.map((r) => r.gmail_message_id as string);
        const unreadDbIds = unreadRows.map((r) => r.id as string);
        const readResult = await markAsReadBulk(gmailAccount, unreadGmailIds);
        const { error: readErr } = await serviceClient
          .from('emails')
          .update({ is_read: true })
          .in('id', unreadDbIds);
        if (readErr) console.error('[tree-action] DB update is_read failed:', readErr);
        return NextResponse.json({
          success: true,
          action: 'mark_read',
          affected: readResult.updated,
          failed: readResult.failed,
        });
      }

      case 'mark_unread': {
        if (gmailAccount.granted_scope !== 'gmail.modify') {
          return NextResponse.json({ error: 'Gmail modify scope required' }, { status: 403 });
        }
        // Only modify read emails
        const readRows = rows.filter((r) => r.is_read === true);
        if (readRows.length === 0) {
          return NextResponse.json({ success: true, action: 'mark_unread', affected: 0 });
        }
        const readGmailIds = readRows.map((r) => r.gmail_message_id as string);
        const readDbIds = readRows.map((r) => r.id as string);
        const unreadResult = await markAsUnreadBulk(gmailAccount, readGmailIds);
        const { error: unreadErr } = await serviceClient
          .from('emails')
          .update({ is_read: false })
          .in('id', readDbIds);
        if (unreadErr) console.error('[tree-action] DB update is_read failed:', unreadErr);
        return NextResponse.json({
          success: true,
          action: 'mark_unread',
          affected: unreadResult.updated,
          failed: unreadResult.failed,
        });
      }

      case 'reassign': {
        // Reassign only works for categorized emails (category-table dimension)
        const categorizedIds = rows
          .filter((r) => getCategory(r.email_categories) != null)
          .map((r) => r.id as string);

        if (categorizedIds.length === 0) {
          return NextResponse.json({ success: true, action: 'reassign', affected: 0 });
        }

        const { error: updateError } = await serviceClient
          .from('email_categories')
          .update({
            category: newCategory,
            confidence: 1.0,
            categorized_at: new Date().toISOString(),
          })
          .in('email_id', categorizedIds);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          action: 'reassign',
          affected: categorizedIds.length,
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
