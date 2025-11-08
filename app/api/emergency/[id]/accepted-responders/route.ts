import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Get accepted responders for an emergency alert
 * Uses admin client to bypass RLS - works regardless of RLS migration status
 * 
 * GET /api/emergency/[id]/accepted-responders
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // Get authenticated user
    const supabase = await createServerClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const params = await context.params
    const alertId = params.id

    if (!alertId) {
      return NextResponse.json(
        { error: 'Missing alert ID' },
        { status: 400 }
      )
    }

    // Use admin client to bypass RLS
    const admin = createAdminClient()

    // Verify user has access to this alert (owns it or is notified about it)
    const { data: alert, error: alertError } = await admin
      .from('emergency_alerts')
      .select('user_id, contacts_notified, status')
      .eq('id', alertId)
      .single()

    if (alertError || !alert) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      )
    }

    // Check if user owns the alert or is notified about it
    const userId = session.user.id
    const isOwner = alert.user_id === userId
    const isNotified = alert.contacts_notified && 
      Array.isArray(alert.contacts_notified) && 
      alert.contacts_notified.some((id: string) => id === userId || id === userId.toString())

    if (!isOwner && !isNotified) {
      return NextResponse.json(
        { error: 'Unauthorized - you do not have access to this alert' },
        { status: 403 }
      )
    }

    // Get accepted responders using admin client (bypasses RLS)
    const { data: acceptedResponses, error: responsesError } = await admin
      .from('alert_responses')
      .select('contact_user_id, acknowledged_at')
      .eq('alert_id', alertId)
      .not('acknowledged_at', 'is', null)
      .order('acknowledged_at', { ascending: false })

    if (responsesError) {
      console.error('[API] Error fetching accepted responders:', responsesError)
      return NextResponse.json(
        { error: 'Failed to fetch accepted responders' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        acceptedResponders: acceptedResponses || [],
        count: acceptedResponses?.length || 0
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('[API] Error in accepted-responders endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

