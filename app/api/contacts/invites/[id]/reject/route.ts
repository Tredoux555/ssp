import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
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
      return NextResponse.json(
        { error: 'User email not found' },
        { status: 400 }
      )
    }

    const params = await context.params
    const inviteId = params.id

    if (!inviteId || typeof inviteId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid invite ID' },
        { status: 400 }
      )
    }

    // Use admin client to bypass RLS for querying and deleting invites
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

    // Verify the invite exists and belongs to this user (email match)
    const { data: invite, error: fetchError } = await admin
      .from('contact_invites')
      .select('*')
      .eq('id', inviteId)
      .ilike('target_email', userEmail)
      .single()

    if (fetchError || !invite) {
      // Handle specific "table not found" error
      if (fetchError?.message?.includes('schema cache') || fetchError?.message?.includes('table') || fetchError?.code === 'PGRST301') {
        console.warn('Schema cache issue - table might not exist')
        return NextResponse.json(
          { error: 'Contact invites feature not available. Please ensure the database is set up correctly.' },
          { status: 503 }
        )
      }
      
      return NextResponse.json(
        { error: 'Invite not found or access denied' },
        { status: 404 }
      )
    }

    // Check if already accepted (shouldn't happen if UI filters correctly, but good to check)
    if (invite.accepted_at) {
      return NextResponse.json(
        { error: 'Invite already accepted' },
        { status: 410 }
      )
    }

    // Delete the invite (rejecting it)
    const { error: deleteError } = await admin
      .from('contact_invites')
      .delete()
      .eq('id', inviteId)

    if (deleteError) {
      console.error('Error rejecting invite:', deleteError)
      return NextResponse.json(
        { error: 'Failed to reject invite' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Unexpected error rejecting invite:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

