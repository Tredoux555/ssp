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
    let admin
    try {
      admin = createAdminClient()
    } catch (adminError: any) {
      console.error('[API] Failed to create admin client:', {
        error: adminError?.message || adminError,
        alertId: alertId
      })
      return NextResponse.json(
        { error: 'Internal server error', details: 'Failed to initialize database connection' },
        { status: 500 }
      )
    }

    // Verify user has access to this alert (owns it or is notified about it)
    const { data: alert, error: alertError } = await admin
      .from('emergency_alerts')
      .select('user_id, contacts_notified, status')
      .eq('id', alertId)
      .single()

    if (alertError || !alert) {
      console.error('[API] Alert query error:', {
        error: alertError,
        code: alertError?.code,
        message: alertError?.message,
        alertId: alertId
      })
      return NextResponse.json(
        { error: 'Alert not found', details: alertError?.message || 'Alert does not exist' },
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

    // First, get all accepted responders (who have acknowledged AND not declined)
    const { data: acceptedResponses, error: responsesError } = await admin
      .from('alert_responses')
      .select('contact_user_id')
      .eq('alert_id', alertId)
      .not('acknowledged_at', 'is', null)
      .is('declined_at', null) // Exclude declined users

    if (responsesError) {
      console.error('[API] Error fetching accepted responders:', {
        code: responsesError.code,
        message: responsesError.message,
        details: responsesError.details,
        hint: responsesError.hint,
        alertId: alertId
      })
      return NextResponse.json(
        { error: 'Failed to fetch accepted responders', details: responsesError.message || 'Database query failed' },
        { status: 500 }
      )
    }

    const acceptedUserIds = acceptedResponses?.map((r: { contact_user_id: string }) => r.contact_user_id) || []

    console.log('[API] 🔍 Querying receiver locations:', {
      alertId: alertId,
      acceptedUserIds: acceptedUserIds,
      acceptedCount: acceptedUserIds.length
    })

    if (acceptedUserIds.length === 0) {
      console.log('[API] ⚠️ No accepted responders found - returning empty locations')
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
    console.log('[API] 🔍 Querying location_history with:', {
      alertId: alertId,
      userIds: acceptedUserIds,
      query: `alert_id = ${alertId} AND user_id IN (${acceptedUserIds.join(', ')})`
    })
    
    const { data: locations, error: locationsError } = await admin
      .from('location_history')
      .select('*')
      .eq('alert_id', alertId)
      .in('user_id', acceptedUserIds)
      .order('created_at', { ascending: false })
      .limit(100) // Limit to last 100 locations per alert

    console.log('[API] 📍 Location query result:', {
      locationCount: locations?.length || 0,
      locations: locations?.map((loc: any) => ({
        id: loc.id,
        userId: loc.user_id,
        alertId: loc.alert_id,
        lat: loc.latitude,
        lng: loc.longitude,
        createdAt: loc.created_at
      })) || [],
      error: locationsError ? {
        code: locationsError.code,
        message: locationsError.message
      } : null
    })

    if (locationsError) {
      console.error('[API] Error fetching receiver locations:', {
        code: locationsError.code,
        message: locationsError.message,
        details: locationsError.details,
        hint: locationsError.hint,
        alertId: alertId
      })
      return NextResponse.json(
        { error: 'Failed to fetch receiver locations', details: locationsError.message || 'Database query failed' },
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

    console.log('[API] ✅ Returning receiver locations:', {
      totalLocations: locations?.length || 0,
      uniqueReceivers: Object.keys(groupedByUser).length,
      receivers: Object.keys(groupedByUser).map(receiverId => ({
        receiverId,
        locationCount: groupedByUser[receiverId].length,
        latestLocation: groupedByUser[receiverId][0] ? {
          lat: groupedByUser[receiverId][0].latitude,
          lng: groupedByUser[receiverId][0].longitude,
          timestamp: groupedByUser[receiverId][0].created_at
        } : null
      }))
    })

    return NextResponse.json(
      {
        success: true,
        receiverLocations: locations || [],
        groupedByUser,
        acceptedUserIds,
        count: locations?.length || 0
      },
      { 
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    )
  } catch (error: any) {
    console.error('[API] Unexpected error in receiver-locations endpoint:', {
      error: error?.message || error,
      stack: error?.stack,
      name: error?.name
    })
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

