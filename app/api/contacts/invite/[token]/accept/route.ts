import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    const supabase = createClient()
    if (!supabase) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { token } = await context.params
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    // Fetch invite
    const { data: invite, error: inviteError } = await supabase
      .from('contact_invites')
      .select('*')
      .eq('token', token)
      .single()

    if (inviteError || !invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.accepted_at) {
      return NextResponse.json({ error: 'Invite already accepted' }, { status: 410 })
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
    }

    // Verify the logged-in user's email matches the invite target
    const sessionEmail = (session.user.email || '').toLowerCase()
    const targetEmail = (invite.target_email || '').toLowerCase()
    if (!sessionEmail || sessionEmail !== targetEmail) {
      return NextResponse.json({ error: 'This invite is not for your email' }, { status: 403 })
    }

    // Use admin client to bypass RLS for inserting into inviter's contacts
    const admin = createAdminClient()

    // Upsert contact: set contact_user_id, ensure email is set, keep existing name if present
    // Try update existing email row, else insert new
    const { error: upsertError } = await admin.rpc('upsert_contact_link', {
      p_user_id: invite.inviter_user_id,
      p_contact_user_id: session.user.id,
      p_email: targetEmail,
    })

    // If helper function not present, fall back to manual upsert
    if (upsertError) {
      // Try update existing by (user_id, lower(email))
      const { data: existing } = await admin
        .from('emergency_contacts')
        .select('id')
        .eq('user_id', invite.inviter_user_id)
        .ilike('email', targetEmail)
        .single()
        .catch(() => ({ data: null })) as any

      if (existing?.id) {
        const { error: updateError } = await admin
          .from('emergency_contacts')
          .update({ contact_user_id: session.user.id })
          .eq('id', existing.id)
        if (updateError) {
          return NextResponse.json({ error: 'Failed to link contact (update)' }, { status: 500 })
        }
      } else {
        const { error: insertError } = await admin
          .from('emergency_contacts')
          .insert({
            user_id: invite.inviter_user_id,
            contact_user_id: session.user.id,
            email: targetEmail,
            name: targetEmail.split('@')[0],
            can_see_location: true,
            verified: true,
          })
        if (insertError) {
          return NextResponse.json({ error: 'Failed to link contact (insert)' }, { status: 500 })
        }
      }
    }

    // Mark invite accepted
    const { error: acceptUpdateError } = await admin
      .from('contact_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('token', token)
    if (acceptUpdateError) {
      return NextResponse.json({ error: 'Failed to mark invite accepted' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


