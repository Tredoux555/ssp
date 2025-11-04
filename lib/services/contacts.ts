'use client'

import { createClient } from '@/lib/supabase'

/**
 * Get incoming contact invites (client-side replacement for /api/contacts/invites/incoming)
 * Uses RLS policy "Invitees can view invites sent to them" which checks if target_email matches user's email
 */
export async function getIncomingInvites(): Promise<Array<{
  id: string
  token: string
  inviter_user_id: string
  inviter_email: string
  inviter_name: string
  created_at: string
  expires_at: string
}>> {
  const supabase = createClient()
  
  if (!supabase) {
    throw new Error('Failed to fetch invites: Server configuration error')
  }

  // Get authenticated user
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  
  if (sessionError || !session?.user) {
    throw new Error('Unauthorized - please sign in')
  }

  const userEmail = session.user.email?.toLowerCase()
  if (!userEmail) {
    return []
  }

  // Query invites where target_email matches logged-in user's email
  // RLS policy "Invitees can view invites sent to them" will filter automatically
  const { data: invites, error: invitesError } = await supabase
    .from('contact_invites')
    .select('id, token, inviter_user_id, target_email, created_at, expires_at, accepted_at')
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (invitesError) {
    console.error('Error fetching incoming invites:', invitesError)
    
    // Handle specific "table not found" error
    if (invitesError.message?.includes('schema cache') || invitesError.message?.includes('table') || invitesError.code === 'PGRST301') {
      console.warn('Schema cache issue - table might not exist or cache needs refresh')
      return []
    }
    
    throw new Error(invitesError.message || 'Failed to fetch invites')
  }

  // If no invites, return empty array
  if (!invites || invites.length === 0) {
    return []
  }

  // Get inviter user info
  const inviterIds = [...new Set(invites.map((invite: any) => invite.inviter_user_id))]
  
  // Get profile info using regular client
  // Note: We can only see profiles of users we have contacts with, or we can use public data
  // For now, we'll try to get profiles, but if RLS blocks it, we'll use fallback
  const { data: inviters } = await supabase
    .from('user_profiles')
    .select('id, email, full_name')
    .in('id', inviterIds)
  
  // For emails, we'll use the invite's inviter_user_id and try to get from emergency_contacts
  // or use a fallback
  const inviterEmails: Record<string, string> = {}
  
  // Try to get emails from contacts if we have them
  if (inviterIds.length > 0) {
    const { data: contacts } = await supabase
      .from('emergency_contacts')
      .select('contact_user_id, email')
      .in('contact_user_id', inviterIds)
      .eq('user_id', session.user.id)
    
    if (contacts) {
      contacts.forEach((contact: any) => {
        if (contact.email) {
          inviterEmails[contact.contact_user_id] = contact.email
        }
      })
    }
  }
  
  // If we still don't have emails, we can't get them from auth.users without admin access
  // But we can show a better message - the invite itself doesn't have inviter email
  // So we'll show "Someone" as a fallback

  // Handle missing inviter info gracefully
  return invites.map((invite: any) => {
    const inviter = inviters?.find((u: any) => u.id === invite.inviter_user_id)
    
    // Try multiple sources for email
    let email = inviter?.email || inviterEmails[invite.inviter_user_id]
    
    // If still no email found, try to get from auth.users via a workaround
    // Since we can't directly query auth.users, we'll use a fallback
    if (!email) {
      // We can't easily get the inviter's email without admin access
      // But we can show a more helpful message
      email = 'Unknown'
    }
    
    let inviterName = 'Unknown User'
    if (inviter?.full_name) {
      inviterName = inviter.full_name
    } else if (email && email !== 'Unknown') {
      inviterName = email.split('@')[0]
    } else {
      // Last resort: show "Someone" instead of "Unknown User" for better UX
      inviterName = 'Someone'
    }
    
    return {
      id: invite.id,
      token: invite.token,
      inviter_user_id: invite.inviter_user_id,
      inviter_email: email,
      inviter_name: inviterName,
      created_at: invite.created_at,
      expires_at: invite.expires_at,
    }
  })
}

/**
 * Create a contact invite (client-side replacement for /api/contacts/invite)
 */
export async function createContactInvite(
  email: string,
  relationship?: string,
  priority?: number
): Promise<{ inviteUrl: string }> {
  const supabase = createClient()
  
  if (!supabase) {
    throw new Error('Failed to create invite: Server configuration error')
  }

  // Get authenticated user
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  
  if (sessionError || !session?.user) {
    throw new Error('Unauthorized - please sign in')
  }

  const trimmedEmail = email.trim()
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error('Valid email is required')
  }

  // Normalize email: trim + lowercase for consistent storage and comparison
  const normalizedEmail = trimmedEmail.toLowerCase()

  // Create invite using regular client (RLS policy "Inviter can insert own invites" allows this)
  const { data: invite, error: insertError } = await supabase
    .from('contact_invites')
    .insert({
      inviter_user_id: session.user.id,
      target_email: normalizedEmail,
    })
    .select()
    .single()

  if (insertError || !invite) {
    console.error('Error creating invite:', insertError)
    throw new Error(insertError?.message || 'Failed to create invite')
  }

  // Build invite URL
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const inviteUrl = `${origin}/contacts/invite/${invite.token}`

  // Optionally pre-create a placeholder contact row (email only)
  // RLS policy "Users can create own contacts" allows this
  try {
    await supabase
      .from('emergency_contacts')
      .insert({
        user_id: session.user.id,
        name: normalizedEmail.split('@')[0],
        email: normalizedEmail,
        relationship: relationship || null,
        priority: typeof priority === 'number' ? priority : 0,
        can_see_location: true,
        verified: false,
      })
      .select()
      .single()
  } catch (contactError) {
    // Ignore duplicate errors - contact might already exist
    console.warn('Failed to pre-create contact (non-critical):', contactError)
  }

  return { inviteUrl }
}

/**
 * Accept a contact invite (client-side replacement for /api/contacts/invite/[token]/accept)
 */
export async function acceptContactInvite(token: string): Promise<void> {
  const supabase = createClient()
  
  if (!supabase) {
    throw new Error('Failed to accept invite: Server configuration error')
  }

  // Get authenticated user
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  
  if (sessionError || !session?.user) {
    throw new Error('Unauthorized - please sign in')
  }

  const accepterUserId = session.user.id
  const accepterEmail = session.user.email?.toLowerCase()

  if (!accepterEmail) {
    throw new Error('User email not found')
  }

  // Get invite details using regular client
  // RLS policy "Invitees can view invites sent to them" will filter automatically
  const { data: invite, error: inviteError } = await supabase
    .from('contact_invites')
    .select('*')
    .eq('token', token)
    .single()

  if (inviteError || !invite) {
    throw new Error('Invite not found or invalid')
  }

  // Verify the invite is for this user (RLS should have filtered, but double-check)
  // Normalize both emails for comparison (trim + lowercase)
  const inviteEmail = invite.target_email?.trim().toLowerCase()
  const userEmail = accepterEmail?.trim().toLowerCase()

  if (!inviteEmail || !userEmail || inviteEmail !== userEmail) {
    // Add debugging info
    console.error('Email mismatch:', {
      inviteEmail,
      userEmail,
      rawInviteEmail: invite.target_email,
      rawUserEmail: session.user.email,
      token
    })
    throw new Error(
      `Invite email does not match your account. ` +
      `Invite email: ${invite.target_email}, Your email: ${session.user.email}. ` +
      `Please ensure you're logged in with the correct account.`
    )
  }

  // Check if invite is already accepted
  if (invite.accepted_at) {
    throw new Error('Invite has already been accepted')
  }

  // Check if invite is expired
  if (new Date(invite.expires_at) < new Date()) {
    throw new Error('Invite has expired')
  }

  // Mark invite as accepted using regular client
  // RLS policy "Invitees can update invites sent to them" allows this
  // Database trigger will automatically create bidirectional contacts
  const { error: updateError } = await supabase
    .from('contact_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  if (updateError) {
    console.error('Failed to mark invite as accepted:', updateError)
    throw new Error(`Failed to accept invite: ${updateError.message}`)
  }

  // Note: Bidirectional contacts are created automatically by database trigger
  // No need to call createBidirectionalContact manually
}

/**
 * Delete a contact (client-side replacement for /api/contacts/[id])
 */
export async function deleteContact(contactId: string): Promise<void> {
  const supabase = createClient()
  
  if (!supabase) {
    throw new Error('Failed to delete contact: Server configuration error')
  }

  // Get authenticated user
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  
  if (sessionError || !session?.user) {
    throw new Error('Unauthorized - please sign in')
  }

  const userId = session.user.id

  // Delete contact (RLS will ensure user can only delete their own contacts)
  const { error } = await supabase
    .from('emergency_contacts')
    .delete()
    .eq('id', contactId)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to delete contact: ${error.message}`)
  }
}

