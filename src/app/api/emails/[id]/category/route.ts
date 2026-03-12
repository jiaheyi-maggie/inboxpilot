import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { CATEGORIES } from '@/types';

export async function PUT(
  request: NextRequest,
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

  const body = await request.json();
  const { category, topic } = body as { category: string; topic?: string };

  if (!category) {
    return NextResponse.json({ error: 'Missing category' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Validate category exists for this user (custom categories, E3)
  const { data: userCategories } = await serviceClient
    .from('user_categories')
    .select('name')
    .eq('user_id', user.id);

  // Validate category against user's custom categories, or fallback defaults
  const validNames = userCategories && userCategories.length > 0
    ? userCategories.map((c) => c.name)
    : [...CATEGORIES];
  if (!validNames.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  // Verify email ownership via gmail_accounts
  const { data: email } = await serviceClient
    .from('emails')
    .select('id, sender_email, sender_domain, subject, gmail_accounts!inner(user_id)')
    .eq('id', emailId)
    .single();

  if (!email) {
    return NextResponse.json({ error: 'Email not found' }, { status: 404 });
  }

  const accountData = email.gmail_accounts as unknown as { user_id: string };
  if (accountData.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch current category before updating (for correction tracking)
  const { data: currentCat } = await serviceClient
    .from('email_categories')
    .select('category')
    .eq('email_id', emailId)
    .single();

  // Upsert category (manual override = confidence 1.0)
  const { data, error } = await serviceClient
    .from('email_categories')
    .upsert(
      {
        email_id: emailId,
        category,
        topic: topic ?? null,
        priority: 'normal',
        confidence: 1.0,
        categorized_at: new Date().toISOString(),
      },
      { onConflict: 'email_id' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mark as categorized
  const { error: catError } = await serviceClient
    .from('emails')
    .update({ is_categorized: true })
    .eq('id', emailId);
  if (catError) {
    console.error('[category] Failed to mark email as categorized:', catError);
  }

  // Record correction if category actually changed (E4: learning loop)
  if (currentCat && currentCat.category && currentCat.category !== category) {
    const { error: corrErr } = await serviceClient
      .from('category_corrections')
      .insert({
        user_id: user.id,
        email_id: emailId,
        original_category: currentCat.category,
        corrected_category: category,
        sender_email: (email as Record<string, unknown>).sender_email as string | null,
        sender_domain: (email as Record<string, unknown>).sender_domain as string | null,
        subject: (email as Record<string, unknown>).subject as string | null,
      });
    if (corrErr) console.error('[category] Failed to record correction:', corrErr);
  }

  return NextResponse.json({ success: true, data });
}
