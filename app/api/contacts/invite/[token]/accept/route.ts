import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'
import { createBidirectionalContact } from '@/lib/emergency'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  try {
    let supabase
    try {
      supabase = await createServerClient()
    } catch (error) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { token } = await context.params
    if (!token) {
      console.error('Accept invite: Missing token')
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    console.log('Accept invite request:', {
      token,
      userId: session.user.id,
      userEmail: session.user.email,
    })

    // Use admin client to bypass RLS for fetching invite
    // Authentication is already verified above, so it's safe to use admin client
    // This follows the same pattern as app/api/contacts/invites/incoming/route.ts
    const admin = createAdminClient()

    // Fetch invite using admin client (bypasses RLS)
    console.log('Fetching invite with token:', token)
    const { data: invite, error: inviteError } = await admin
      .from('contact_invites')
      .select('*')
      .eq('token', token)
      .single()

    if (inviteError || !invite) {
      console.error('Invite not found:', {
        error: inviteError,
        token,
      })
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    console.log('Invite found:', {
      id: invite.id,
      inviter_user_id: invite.inviter_user_id,
      target_email: invite.target_email,
      accepted_at: invite.accepted_at,
      expires_at: invite.expires_at,
    })

    if (invite.accepted_at) {
      console.warn('Invite already accepted:', invite.id)
      return NextResponse.json({ error: 'Invite already accepted' }, { status: 410 })
    }
    
    const now = Date.now()
    const expiresAt = new Date(invite.expires_at).getTime()
    if (expiresAt < now) {
      console.warn('Invite expired:', {
        id: invite.id,
        expires_at: invite.expires_at,
        now: new Date().toISOString(),
      })
      return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
    }

    // Verify the logged-in user's email matches the invite target
    const sessionEmail = (session.user.email || '').toLowerCase()
    const targetEmail = (invite.target_email || '').toLowerCase()
    
    console.log('Email verification:', {
      sessionEmail,
      targetEmail,
      match: sessionEmail === targetEmail,
    })
    
    if (!sessionEmail || sessionEmail !== targetEmail) {
      console.error('Email mismatch:', {
        sessionEmail,
        targetEmail,
        inviteId: invite.id,
      })
      return NextResponse.json({ 
        error: `This invite is not for your email. Invite was sent to ${targetEmail}, but you are logged in as ${sessionEmail}` 
      }, { status: 403 })
    }

    // Get inviter's email from auth.users (needed for bidirectional contact creation)
    let inviterEmail: string | undefined = undefined
    try {
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(invite.inviter_user_id)
      if (!authError && authUser?.user?.email) {
        inviterEmail = authUser.user.email
      }
    } catch (authErr) {
      console.warn('Could not get inviter email from auth:', authErr)
      // Continue - will use email from invite if available
    }

    if (!inviterEmail) {
      // Try to get email from invite or use a fallback
      console.warn('Inviter email not found - using fallback')
      inviterEmail = `user-${invite.inviter_user_id.substring(0, 8)}@unknown`
    }

    // Create bidirectional contacts - both users become emergency contacts for each other
    try {
      await createBidirectionalContact(
        invite.inviter_user_id,
        session.user.id,
        inviterEmail,
        targetEmail
      )
    } catch (contactError: any) {
      console.error('Failed to create bidirectional contacts:', contactError)
      return NextResponse.json(
        { error: contactError.message || 'Failed to create emergency contacts' },
        { status: 500 }
      )
    }

    // Mark invite accepted
    console.log('Marking invite as accepted:', invite.id)
    const { error: acceptUpdateError } = await admin
      .from('contact_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('token', token)
    if (acceptUpdateError) {
      console.error('Failed to mark invite as accepted:', acceptUpdateError)
      return NextResponse.json({ error: 'Failed to mark invite accepted' }, { status: 500 })
    }

    console.log('Invite accepted successfully:', {
      inviteId: invite.id,
      inviterUserId: invite.inviter_user_id,
      contactUserId: session.user.id,
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Unexpected error accepting invite:', {
      error,
      errorType: typeof error,
      errorConstructor: error?.constructor?.name,
      message: error?.message,
      stack: error?.stack,
    })
    
    // Provide more detailed error message for debugging
    const errorMessage = error?.message || 'Internal server error'
    const errorDetails = process.env.NODE_ENV === 'development' 
      ? {
          message: errorMessage,
          type: typeof error,
          constructor: error?.constructor?.name,
        }
      : undefined
    
    return NextResponse.json({ 
      error: errorMessage,
      ...(errorDetails && { details: errorDetails })
    }, { status: 500 })
  }
}


