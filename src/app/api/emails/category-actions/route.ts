import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { trashEmails, archiveEmails } from '@/lib/gmail/client';
import type { GmailAccount } from '@/types';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { action, category, newCategory } = body as {
    action: 'trash' | 'archive' | 'reassign';
    category: string;
    newCategory?: string;
  };

  if (!action || !category) {
    return NextResponse.json({ error: 'Missing action or category' }, { status: 400 });
  }

  if (action === 'reassign' && !newCategory) {
    return NextResponse.json({ error: 'Missing newCategory for reassign' }, { status: 400 });
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

  // Find all emails in this category belonging to this user
  const { data: emails, error: fetchError } = await serviceClient
    .from('emails')
    .select('id, gmail_message_id, label_ids, email_categories!inner(category)')
    .eq('gmail_account_id', gmailAccount.id)
    .eq('email_categories.category', category);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!emails || emails.length === 0) {
    return NextResponse.json({ success: true, affected: 0 });
  }

  const emailIds = emails.map((e) => e.id);
  const gmailMessageIds = emails.map((e) => e.gmail_message_id);

  try {
    switch (action) {
      case 'trash': {
        if (gmailAccount.granted_scope !== 'gmail.modify') {
          return NextResponse.json(
            { error: 'Gmail modify scope required' },
            { status: 403 }
          );
        }
        const trashResult = await trashEmails(gmailAccount, gmailMessageIds);
        // Delete from DB (cascade deletes email_categories)
        const { error: deleteError } = await serviceClient
          .from('emails')
          .delete()
          .in('id', emailIds);
        if (deleteError) {
          console.error('[category-action] DB delete failed:', deleteError);
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
          return NextResponse.json(
            { error: 'Gmail modify scope required' },
            { status: 403 }
          );
        }
        const archiveResult = await archiveEmails(gmailAccount, gmailMessageIds);
        // Update label_ids in DB — remove INBOX label for each email
        await Promise.allSettled(
          emails.map((e) => {
            const currentLabels = (e.label_ids as string[]) ?? [];
            const newLabels = currentLabels.filter((l: string) => l !== 'INBOX');
            return serviceClient
              .from('emails')
              .update({ label_ids: newLabels })
              .eq('id', e.id);
          })
        );
        return NextResponse.json({
          success: true,
          action: 'archive',
          affected: archiveResult.archived,
          failed: archiveResult.failed,
        });
      }

      case 'reassign': {
        // Update all email_categories rows for these emails
        const { error: updateError } = await serviceClient
          .from('email_categories')
          .update({
            category: newCategory,
            confidence: 1.0, // manual override
            categorized_at: new Date().toISOString(),
          })
          .in('email_id', emailIds);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          action: 'reassign',
          affected: emailIds.length,
          newCategory,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[category-action] ${action} failed for category=${category}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Action failed' },
      { status: 500 }
    );
  }
}
