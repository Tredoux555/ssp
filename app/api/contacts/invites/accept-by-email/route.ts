import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let supabase
    try {
      supabase = await createServerClient()
    } catch (error) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Get authenticated user
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const email: string = (body?.email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      )
    }

    const userEmail = session.user.email?.toLowerCase()
    if (!userEmail || userEmail !== email) {
      return NextResponse.json(
        { error: 'You can only accept invites sent to your own email' },
        { status: 403 }
      )
    }

    // Use admin client to bypass RLS
    let admin
    try {
      admin = createAdminClient()
    } catch (adminError: any) {
      console.error('Failed to create admin client:', adminError)
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Find pending invite for this email
    const { data: invite, error: inviteError } = await admin
      .from('contact_invites')
      .select('token, id, inviter_user_id, target_email, expires_at, accepted_at')
      .ilike('target_email', email)
      .is('accepted_at', null) // Only pending invites
      .gt('expires_at', new Date().toISOString()) // Not expired
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (inviteError) {
      // Handle schema cache errors gracefully
      if (inviteError.message?.includes('schema cache') || inviteError.message?.includes('table') || inviteError.code === 'PGRST301') {
        console.warn('Schema cache issue - table might not exist')
        return NextResponse.json(
          { error: 'No pending invite found. Please ensure the database is set up correctly.' },
          { status: 404 }
        )
      }
      
      console.error('Error finding invite:', inviteError)
      return NextResponse.json(
        { error: inviteError.message || 'Failed to find invite' },
        { status: 500 }
      )
    }

    if (!invite) {
      return NextResponse.json(
        { error: 'No pending invite found for this email' },
        { status: 404 }
      )
    }

    // Accept the invite - update contact to set contact_user_id and verified=true
    // This follows the same pattern as app/api/contacts/invite/[token]/accept/route.ts
    let existingContact: { id?: string } | null = null
    try {
      const { data } = await admin
        .from('emergency_contacts')
        .select('id')
        .eq('user_id', invite.inviter_user_id)
        .ilike('email', email)
        .maybeSingle()
      existingContact = data || null
    } catch {
      // No existing contact found - will insert new one
      existingContact = null
    }

    if (existingContact?.id) {
      // Update existing contact
      const { error: updateError } = await admin
        .from('emergency_contacts')
        .update({ 
          contact_user_id: session.user.id,
          verified: true 
        })
        .eq('id', existingContact.id)
      
      if (updateError) {
        console.error('Error updating contact:', updateError)
        return NextResponse.json(
          { error: 'Failed to accept invite' },
          { status: 500 }
        )
      }
    } else {
      // Insert new contact
      const { error: insertError } = await admin
        .from('emergency_contacts')
        .insert({
          user_id: invite.inviter_user_id,
          contact_user_id: session.user.id,
          email: email,
          name: email.split('@')[0],
          can_see_location: true,
          verified: true,
        })
      
      if (insertError) {
        console.error('Error inserting contact:', insertError)
        return NextResponse.json(
          { error: 'Failed to accept invite' },
          { status: 500 }
        )
      }
    }

    // Mark invite as accepted
    const { error: acceptError } = await admin
      .from('contact_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id)

    if (acceptError) {
      console.warn('Failed to mark invite accepted (non-critical):', acceptError)
      // Don't fail - contact is already linked
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Unexpected error accepting invite by email:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

