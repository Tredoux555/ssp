import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    let supabase
    try {
      supabase = createServerClient()
    } catch (error) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const { token } = await context.params
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    const { data: invite, error } = await supabase
      .from('contact_invites')
      .select('inviter_user_id, target_email, expires_at, accepted_at')
      .eq('token', token)
      .single()

    if (error || !invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.accepted_at) {
      return NextResponse.json({ error: 'Invite already accepted' }, { status: 410 })
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
    }

    const masked = invite.target_email.replace(/(^.).+(@.+$)/, '$1***$2')

    return NextResponse.json({
      inviter_user_id: invite.inviter_user_id,
      target_email_masked: masked,
      expires_at: invite.expires_at,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


