import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
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

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const email: string = (body?.email || '').trim()
    const relationship: string | undefined = body?.relationship?.trim() || undefined
    const priority: number | undefined = typeof body?.priority === 'number' ? body.priority : undefined

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }

    // Use admin client to bypass RLS for both invite creation and contact creation
    // Authentication is already verified above, so it's safe to use admin client
    // This follows the same pattern as app/api/emergency/cancel/route.ts
    const admin = createAdminClient()

    // Create invite using admin client (bypasses RLS)
    const { data: invite, error: insertError } = await admin
      .from('contact_invites')
      .insert({
        inviter_user_id: session.user.id,
        target_email: email,
      })
      .select()
      .single()

    if (insertError || !invite) {
      console.error('Error creating invite:', insertError)
      return NextResponse.json({ error: insertError?.message || 'Failed to create invite' }, { status: 500 })
    }

    // Build invite URL
    const origin = request.headers.get('origin') || ''
    const inviteUrl = `${origin}/contacts/invite/${invite.token}`

    // Optionally pre-create a placeholder contact row (email only) to avoid duplicates
    // Try insert, ignore duplicates
    try {
      await admin
        .from('emergency_contacts')
        .insert({
          user_id: session.user.id,
          name: email.split('@')[0],
          email,
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

    return NextResponse.json({ inviteUrl }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


