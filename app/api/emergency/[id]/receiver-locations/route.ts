import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase-server'
import { LocationHistory } from '@/types/database'

/**
 * Get receiver locations for an emergency alert
 * Uses admin client to bypass RLS - works regardless of RLS migration status
 * Only returns locations for users who have accepted to respond
 * 
 * GET /api/emergency/[id]/receiver-locations
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

    // First, get all accepted responders
    const { data: acceptedResponses, error: responsesError } = await admin
      .from('alert_responses')
      .select('contact_user_id')
      .eq('alert_id', alertId)
      .not('acknowledged_at', 'is', null)

    if (responsesError) {
      console.error('[API] Error fetching accepted responders:', responsesError)
      return NextResponse.json(
        { error: 'Failed to fetch accepted responders' },
        { status: 500 }
      )
    }

    const acceptedUserIds = acceptedResponses?.map((r: { contact_user_id: string }) => r.contact_user_id) || []

    if (acceptedUserIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          receiverLocations: [],
          groupedByUser: {}
        },
        { status: 200 }
      )
    }

    // Get all locations for accepted responders using admin client (bypasses RLS)
    const { data: locations, error: locationsError } = await admin
      .from('location_history')
      .select('*')
      .eq('alert_id', alertId)
      .in('user_id', acceptedUserIds)
      .order('created_at', { ascending: false })
      .limit(100) // Limit to last 100 locations per alert

    if (locationsError) {
      console.error('[API] Error fetching receiver locations:', locationsError)
      return NextResponse.json(
        { error: 'Failed to fetch receiver locations' },
        { status: 500 }
      )
    }

    // Group locations by user_id
    const groupedByUser: Record<string, LocationHistory[]> = {}
    locations?.forEach((loc: LocationHistory) => {
      const receiverId = loc.user_id
      if (!groupedByUser[receiverId]) {
        groupedByUser[receiverId] = []
      }
      groupedByUser[receiverId].push(loc)
    })

    return NextResponse.json(
      {
        success: true,
        receiverLocations: locations || [],
        groupedByUser,
        acceptedUserIds,
        count: locations?.length || 0
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('[API] Error in receiver-locations endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

