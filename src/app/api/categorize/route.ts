import { NextRequest, NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { categorizeEmails, getUncategorizedEmails, getCategorizedEmails } from '@/lib/ai/categorize';
import { markAsReadBulk } from '@/lib/gmail/client';
import type { GmailAccount } from '@/types';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse optional body
  let markRead = false;
  let recategorize = false;
  let refinementPrompt: string | undefined;
  let sourceCategory: string | undefined;
  try {
    const body = await request.json();
    markRead = body?.markRead === true;
    recategorize = body?.recategorize === true;
    if (typeof body?.refinementPrompt === 'string') refinementPrompt = body.refinementPrompt;
    if (typeof body?.sourceCategory === 'string') sourceCategory = body.sourceCategory;
  } catch {
    // No body or invalid JSON — that's fine, defaults apply
  }

  const serviceClient = createServiceClient();

  const { data: allAccounts } = await serviceClient
    .from('gmail_accounts')
    .select('*')
    .eq('user_id', user.id);

  if (!allAccounts || allAccounts.length === 0) {
    return NextResponse.json(
      { error: 'No Gmail account linked' },
      { status: 404 }
    );
  }

  const account = allAccounts[0];

  // ── Recategorize branch: re-evaluate already-categorized emails with new context ──
  if (recategorize) {
    const RECATEGORIZE_LIMIT = 100;
    const emailsToRecategorize = await getCategorizedEmails(user.id, {
      sourceCategory,
      limit: RECATEGORIZE_LIMIT,
    });

    if (emailsToRecategorize.length === 0) {
      return NextResponse.json({
        success: true,
        recategorized: 0,
        message: 'No categorized emails found to re-evaluate',
      });
    }

    // Mark as pending so UI shows spinners
    const recatIds = emailsToRecategorize.map((e) => e.id);
    const serviceClientRecat = createServiceClient();
    await serviceClientRecat
      .from('emails')
      .update({ categorization_status: 'pending' })
      .in('id', recatIds);

    // Build account map for scoped categorization
    const accountMapRecat = new Map<string, GmailAccount>();
    for (const a of allAccounts) {
      accountMapRecat.set(a.id, a as GmailAccount);
    }

    // Run recategorization in background so the response returns immediately
    const emailsForBg = [...emailsToRecategorize];
    after(async () => {
      try {
        // Group by account for proper category scoping
        const byAccount = new Map<string, typeof emailsForBg>();
        for (const e of emailsForBg) {
          const list = byAccount.get(e.gmail_account_id) ?? [];
          list.push(e);
          byAccount.set(e.gmail_account_id, list);
        }

        let totalCategorized = 0;
        let totalErrors = 0;
        for (const [accountId, emails] of byAccount) {
          console.log(`[recategorize-bg] Re-categorizing ${emails.length} emails for account ${accountId}`);
          const result = await categorizeEmails(emails, user.id, {
            gmailAccountId: accountId,
            refinementPrompt,
            sourceCategory,
          });
          totalCategorized += result.categorized;
          totalErrors += result.errors;
        }
        console.log(`[recategorize-bg] Done: recategorized=${totalCategorized}, errors=${totalErrors}`);
      } catch (err) {
        console.error('[recategorize-bg] Background recategorization failed:', err);
      }
    });

    return NextResponse.json({
      success: true,
      pending: emailsToRecategorize.length,
      message: `Re-categorizing ${emailsToRecategorize.length} emails in background`,
    });
  }

  // Fetch uncategorized emails across ALL accounts
  const uncategorizedLists = await Promise.all(
    allAccounts.map((a) => getUncategorizedEmails(a.id, { includeUnread: true }))
  );
  const uncategorized = uncategorizedLists.flat();

  if (uncategorized.length === 0) {
    return NextResponse.json({
      success: true,
      categorized: 0,
      message: 'All emails are already categorized',
    });
  }

  // If markRead requested, mark all unread emails as read in Gmail + DB
  const unreadEmails = markRead ? uncategorized.filter((e) => !e.is_read) : [];
  if (unreadEmails.length > 0) {
    const emailIds = unreadEmails.map((e) => e.id);

    // Update DB immediately so UI reflects the change
    await serviceClient
      .from('emails')
      .update({ is_read: true })
      .in('id', emailIds);

    // Mark as read in Gmail in background (non-blocking), grouped by account
    const unreadByAccount = new Map<string, string[]>();
    for (const e of unreadEmails) {
      const list = unreadByAccount.get(e.gmail_account_id) ?? [];
      list.push(e.gmail_message_id);
      unreadByAccount.set(e.gmail_account_id, list);
    }

    after(async () => {
      for (const [accountId, gmailMessageIds] of unreadByAccount) {
        const acct = allAccounts.find((a) => a.id === accountId);
        if (!acct) continue;
        try {
          const result = await markAsReadBulk(acct as GmailAccount, gmailMessageIds);
          if (result.failed > 0) {
            console.warn(`[categorize] markAsReadBulk for ${(acct as GmailAccount).email}: ${result.failed}/${gmailMessageIds.length} failed`);
          }
        } catch (err) {
          console.error(`[categorize] markAsReadBulk failed for account ${accountId}:`, err);
        }
      }
    });
  }

  // Mark emails as pending categorization
  const uncategorizedIds = uncategorized.map((e) => e.id);
  await serviceClient
    .from('emails')
    .update({ categorization_status: 'pending' })
    .in('id', uncategorizedIds);

  // Schedule background categorization + workflow execution
  // Build account lookup for workflows
  const accountMap = new Map<string, GmailAccount>();
  for (const a of allAccounts) {
    accountMap.set(a.id, a as GmailAccount);
  }
  const uncategorizedForBg = [...uncategorized];

  after(async () => {
    try {
      // Group uncategorized emails by account so each batch uses the right categories
      const byAccount = new Map<string, typeof uncategorizedForBg>();
      for (const e of uncategorizedForBg) {
        const list = byAccount.get(e.gmail_account_id) ?? [];
        list.push(e);
        byAccount.set(e.gmail_account_id, list);
      }

      let totalCategorized = 0;
      let totalErrors = 0;
      for (const [accountId, emails] of byAccount) {
        console.log(`[categorize-bg] Categorizing ${emails.length} emails for account ${accountId}`);
        const result = await categorizeEmails(emails, user.id, { gmailAccountId: accountId });
        totalCategorized += result.categorized;
        totalErrors += result.errors;
      }
      console.log(`[categorize-bg] Done: categorized=${totalCategorized}, errors=${totalErrors}`);

      const result = { categorized: totalCategorized, errors: totalErrors };

      // Fire email_categorized workflows for newly categorized emails
      if (result.categorized > 0) {
        try {
          const bgServiceClient = createServiceClient();
          const { runWorkflowsForEmail } = await import('@/lib/workflows/runner');
          const { data: categorizedEmails } = await bgServiceClient
            .from('emails')
            .select('*, email_categories(*)')
            .in('id', uncategorizedForBg.map((e) => e.id))
            .eq('is_categorized', true);

          if (categorizedEmails && categorizedEmails.length > 0) {
            console.log(`[categorize-bg] Running email_categorized workflows for ${categorizedEmails.length} emails`);
            for (const emailRow of categorizedEmails) {
              const cat = (emailRow as Record<string, unknown>).email_categories;
              const catObj = Array.isArray(cat) ? cat[0] : cat;
              const emailWithCat = {
                ...emailRow,
                email_categories: undefined,
                category: (catObj as Record<string, unknown>)?.category as string ?? null,
                topic: (catObj as Record<string, unknown>)?.topic as string ?? null,
                priority: (catObj as Record<string, unknown>)?.priority as string ?? null,
                confidence: (catObj as Record<string, unknown>)?.confidence as number ?? null,
                importance_score: (catObj as Record<string, unknown>)?.importance_score as number ?? null,
                importance_label: (catObj as Record<string, unknown>)?.importance_label as string ?? null,
              };
              const emailAccountId = (emailRow as Record<string, unknown>).gmail_account_id as string;
              const emailAccount = accountMap.get(emailAccountId) ?? allAccounts[0] as GmailAccount;
              await runWorkflowsForEmail(emailWithCat, 'email_categorized', emailAccount);
            }
          }
        } catch (wfErr) {
          console.error('[categorize-bg] email_categorized workflow execution failed:', wfErr);
        }
      }
    } catch (err) {
      console.error('[categorize-bg] Background categorization failed:', err);
    }
  });

  return NextResponse.json({
    success: true,
    pending: uncategorized.length,
    markedRead: unreadEmails.length,
    message: `Categorizing ${uncategorized.length} emails in background`,
  });
}
