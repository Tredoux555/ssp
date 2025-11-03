import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

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

    // Admin client already created above for fetching invite
    // Continue using it for inserting into inviter's contacts

    console.log('Linking contact:', {
      inviter_user_id: invite.inviter_user_id,
      contact_user_id: session.user.id,
      email: targetEmail,
    })

    // Upsert contact: set contact_user_id, ensure email is set, keep existing name if present
    // Try update existing email row, else insert new
    const { error: upsertError } = await admin.rpc('upsert_contact_link', {
      p_user_id: invite.inviter_user_id,
      p_contact_user_id: session.user.id,
      p_email: targetEmail,
    })

    // If helper function not present, fall back to manual upsert
    if (upsertError) {
      console.log('RPC function not available, using manual upsert')
      
      // Try update existing by (user_id, lower(email))
      let existing: { id?: string } | null = null
      try {
        const { data } = await admin
          .from('emergency_contacts')
          .select('id')
          .eq('user_id', invite.inviter_user_id)
          .ilike('email', targetEmail)
          .single()
        existing = data
        console.log('Found existing contact:', existing?.id)
      } catch {
        // No existing contact found - will insert new one
        existing = null
        console.log('No existing contact found, will insert new')
      }

      if (existing?.id) {
        console.log('Updating existing contact:', existing.id)
        const { error: updateError } = await admin
          .from('emergency_contacts')
          .update({ 
            contact_user_id: session.user.id,
            verified: true 
          })
          .eq('id', existing.id)
        if (updateError) {
          console.error('Failed to update contact:', updateError)
          return NextResponse.json({ error: 'Failed to link contact (update)' }, { status: 500 })
        }
        console.log('Contact updated successfully and marked as verified')
      } else {
        console.log('Inserting new contact')
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
          console.error('Failed to insert contact:', insertError)
          return NextResponse.json({ error: 'Failed to link contact (insert)' }, { status: 500 })
        }
        console.log('Contact inserted successfully')
      }
    } else {
      console.log('Contact linked via RPC function')
    }

    // ALSO create/update a contact in the ACCEPTER's list pointing to the inviter
    // This ensures both users see each other in their contact lists
    console.log('Creating contact in accepter\'s list for inviter:', {
      accepter_user_id: session.user.id,
      inviter_user_id: invite.inviter_user_id,
    })
    
    // Get inviter's email from auth.users (we need it for the contact record)
    let inviterEmail: string | undefined = undefined
    try {
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(invite.inviter_user_id)
      if (!authError && authUser?.user?.email) {
        inviterEmail = authUser.user.email
        console.log('Got inviter email from auth:', inviterEmail)
      }
    } catch (authErr) {
      console.warn('Could not get inviter email from auth (non-critical):', authErr)
    }
    
    // Check if accepter already has a contact for the inviter
    let accepterContact: { id?: string } | null = null
    try {
      const { data } = await admin
        .from('emergency_contacts')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('contact_user_id', invite.inviter_user_id)
        .maybeSingle()
      accepterContact = data || null
      console.log('Found existing accepter contact:', accepterContact?.id)
    } catch {
      accepterContact = null
      console.log('No existing accepter contact found')
    }
    
    if (accepterContact?.id) {
      // Update existing contact to mark as verified
      const { error: updateAccepterError } = await admin
        .from('emergency_contacts')
        .update({ verified: true })
        .eq('id', accepterContact.id)
      
      if (updateAccepterError) {
        console.warn('Failed to update accepter contact (non-critical):', updateAccepterError)
      } else {
        console.log('Updated accepter contact as verified')
      }
    } else {
      // Insert new contact in accepter's list for the inviter
      const { error: insertAccepterError } = await admin
        .from('emergency_contacts')
        .insert({
          user_id: session.user.id,
          contact_user_id: invite.inviter_user_id,
          email: inviterEmail || undefined,
          name: inviterEmail ? inviterEmail.split('@')[0] : 'Contact',
          can_see_location: true,
          verified: true,
        })
      
      if (insertAccepterError) {
        console.warn('Failed to insert accepter contact (non-critical):', insertAccepterError)
      } else {
        console.log('Inserted new contact in accepter\'s list')
      }
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


