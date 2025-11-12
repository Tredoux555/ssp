import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Diagnostic endpoint to verify acceptance data for an alert
 * GET /api/diagnostics/acceptance-verification?alertId=X
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const alertId = searchParams.get('alertId')

    if (!alertId) {
      return NextResponse.json(
        { error: 'Missing alertId query parameter' },
        { status: 400 }
      )
    }

    // Get authenticated user
    const supabase = await createServerClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Use admin client to bypass RLS
    const admin = createAdminClient()

    // Get all alert_responses for this alert
    const { data: responses, error: responsesError } = await admin
      .from('alert_responses')
      .select('*')
      .eq('alert_id', alertId)
      .order('acknowledged_at', { ascending: false })

    // Get accepted responders (acknowledged and not declined)
    const acceptedResponses = responses?.filter(r => 
      r.acknowledged_at && !r.declined_at
    ) || []

    // Get location_history for each accepted responder
    const acceptedUserIds = acceptedResponses.map(r => r.contact_user_id)
    const locationData: Record<string, any[]> = {}

    if (acceptedUserIds.length > 0) {
      const { data: locations, error: locationsError } = await admin
        .from('location_history')
        .select('*')
        .eq('alert_id', alertId)
        .in('user_id', acceptedUserIds)
        .order('created_at', { ascending: false })

      // Group locations by user_id
      locations?.forEach((loc: any) => {
        if (!locationData[loc.user_id]) {
          locationData[loc.user_id] = []
        }
        locationData[loc.user_id].push(loc)
      })
    }

    return NextResponse.json({
      success: true,
      alertId,
      allResponses: {
        count: responses?.length || 0,
        responses: responses || [],
        error: responsesError ? {
          code: responsesError.code,
          message: responsesError.message
        } : null
      },
      acceptedResponders: {
        count: acceptedResponses.length,
        userIds: acceptedUserIds,
        responses: acceptedResponses.map(r => ({
          contactUserId: r.contact_user_id,
          acknowledgedAt: r.acknowledged_at,
          declinedAt: r.declined_at
        }))
      },
      locationHistory: {
        totalLocations: Object.values(locationData).reduce((sum, locs) => sum + locs.length, 0),
        locationsByUser: Object.entries(locationData).map(([userId, locs]) => ({
          userId,
          locationCount: locs.length,
          latestLocation: locs.length > 0 ? {
            id: locs[0].id,
            lat: locs[0].latitude,
            lng: locs[0].longitude,
            createdAt: locs[0].created_at
          } : null,
          allLocations: locs.map(loc => ({
            id: loc.id,
            lat: loc.latitude,
            lng: loc.longitude,
            createdAt: loc.created_at
          }))
        }))
      },
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('[DIAG] [API] Error in acceptance-verification:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

