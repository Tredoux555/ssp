'use client'

import { createClient } from '@/lib/supabase'

/**
 * Get incoming contact invites (client-side replacement for /api/contacts/invites/incoming)
 * Uses the API route which has admin access to get inviter emails from auth.users
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
  try {
    const res = await fetch('/api/contacts/invites/incoming', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      let error: any = { error: 'Failed to fetch invites' }
      try {
        error = await res.json()
      } catch {
        // If response isn't JSON, use default error
      }
      
      // Log error but don't throw for client-side handling
      console.warn('[Contacts] Failed to fetch invites:', {
        status: res.status,
        statusText: res.statusText,
        error: error.error || 'Unknown error'
      })
      
      // Return empty array for non-critical errors (UI will handle gracefully)
      if (res.status === 401 || res.status === 403) {
        // Auth errors - return empty array, UI will handle
        return []
      }
      
      // For other errors, still return empty array to prevent UI breakage
      return []
    }

    const data = await res.json()
    return data.invites || []
  } catch (error: any) {
    // Handle network errors gracefully - return empty array instead of throwing
    if (error instanceof TypeError || error.message?.includes('fetch') || error.message?.includes('Network error')) {
      console.warn('[Contacts] Network error fetching invites (returning empty array):', {
        error: error.message || error,
        type: error.constructor?.name || typeof error
      })
      // Return empty array for network errors - UI already handles this gracefully
      return []
    }
    
    // For other errors, log and return empty array to prevent UI breakage
    console.error('[Contacts] Error fetching incoming invites:', {
      error: error?.message || error,
      type: error?.constructor?.name || typeof error
    })
    
    // Return empty array instead of throwing - UI will handle gracefully
    return []
  }
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

  // Note: We no longer pre-create placeholder contacts to avoid duplicates
  // The database trigger will create verified contacts when the invite is accepted
  // This prevents duplicate contacts (one pending, one verified)

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

