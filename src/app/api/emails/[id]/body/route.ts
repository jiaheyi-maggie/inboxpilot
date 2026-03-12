import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { fetchEmailBody } from '@/lib/gmail/client';
import type { GmailAccount } from '@/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: emailId } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();

  // Get the email with account info (same join pattern as actions route)
  const { data: email, error: emailError } = await serviceClient
    .from('emails')
    .select(
      '*, gmail_accounts!inner(user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, id, email, history_id, last_sync_at, sync_enabled, granted_scope, created_at)'
    )
    .eq('id', emailId)
    .single();

  if (emailError || !email) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 });
  }

  const accountData = email.gmail_accounts as unknown as GmailAccount;
  if (accountData.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // If body already cached in DB, return it
  if (email.body_html !== null || email.body_text !== null) {
    return NextResponse.json({
      body_html: email.body_html as string | null,
      body_text: email.body_text as string | null,
    });
  }

  // Fetch from Gmail API and cache
  try {
    const { body_html, body_text } = await fetchEmailBody(
      accountData,
      email.gmail_message_id as string
    );

    // Cache in DB (fire-and-forget — don't block response on cache write)
    serviceClient
      .from('emails')
      .update({ body_html, body_text })
      .eq('id', emailId)
      .then(({ error: cacheErr }) => {
        if (cacheErr) console.error('[email-body] Cache write failed:', cacheErr);
      });

    return NextResponse.json({ body_html, body_text });
  } catch (err) {
    console.error(`[email-body] Failed to fetch body for ${emailId}:`, err);
    return NextResponse.json(
      { error: 'Failed to fetch email body' },
      { status: 500 }
    );
  }
}
