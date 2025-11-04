import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

// This route cannot be statically exported (API route)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<NextResponse> {
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

    const userEmail = session.user.email?.toLowerCase()
    if (!userEmail) {
      // Return empty array if user has no email (don't error)
      return NextResponse.json({ invites: [] }, { status: 200 })
    }

    // Use admin client to bypass RLS for querying invites
    // Authentication is already verified above, so it's safe to use admin client
    // This follows the same pattern as app/api/contacts/invite/[token]/accept/route.ts
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

    // Query invites where target_email matches logged-in user's email
    const { data: invites, error: invitesError } = await admin
      .from('contact_invites')
      .select('id, token, inviter_user_id, target_email, created_at, expires_at, accepted_at')
      .ilike('target_email', userEmail)
      .is('accepted_at', null) // Only pending invites
      .gt('expires_at', new Date().toISOString()) // Not expired
      .order('created_at', { ascending: false })

    if (invitesError) {
      console.error('Error fetching incoming invites:', invitesError)
      
      // Handle specific "table not found" error - might be schema cache issue
      if (invitesError.message?.includes('schema cache') || invitesError.message?.includes('table') || invitesError.code === 'PGRST301') {
        console.warn('Schema cache issue - table might not exist or cache needs refresh')
        // Return empty array instead of error - table might not be created yet
        return NextResponse.json({ invites: [] }, { status: 200 })
      }
      
      return NextResponse.json(
        { error: invitesError.message || 'Failed to fetch invites' },
        { status: 500 }
      )
    }

    // If no invites, return empty array
    if (!invites || invites.length === 0) {
      return NextResponse.json({ invites: [] }, { status: 200 })
    }

    // Get inviter user info
    const inviterIds = [...new Set(invites.map((invite: any) => invite.inviter_user_id))]
    
    // Get profile info
    const { data: inviters } = await admin
      .from('user_profiles')
      .select('id, email, full_name')
      .in('id', inviterIds)

    // Get emails from auth.users for inviters without profile emails
    const inviterEmails: Record<string, string> = {}
    for (const inviterId of inviterIds) {
      const inviterProfile = inviters?.find((u: any) => u.id === inviterId)
      if (!inviterProfile?.email) {
        // Try to get email from auth.users using admin client
        try {
          const { data: authUser } = await admin.auth.admin.getUserById(inviterId)
          if (authUser?.user?.email) {
            inviterEmails[inviterId] = authUser.user.email
          }
        } catch {
          // Ignore - will use fallback
        }
      }
    }

    // Handle missing inviter info gracefully (don't fail)
    const invitesWithInviter = invites.map((invite: any) => {
      const inviter = inviters?.find((u: any) => u.id === invite.inviter_user_id)
      const email = inviter?.email || inviterEmails[invite.inviter_user_id] || 'Unknown'
      
      // Determine name with better fallbacks
      let inviterName = 'Unknown User'
      if (inviter?.full_name) {
        inviterName = inviter.full_name
      } else if (email && email !== 'Unknown') {
        inviterName = email.split('@')[0] // Use email prefix as name
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

    return NextResponse.json({ invites: invitesWithInviter }, { status: 200 })
  } catch (error: any) {
    console.error('Unexpected error fetching incoming invites:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

