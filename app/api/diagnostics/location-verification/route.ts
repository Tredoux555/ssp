import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Diagnostic endpoint to verify location data exists in database
 * GET /api/diagnostics/location-verification?alertId=X&userId=Y
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const alertId = searchParams.get('alertId')
    const userId = searchParams.get('userId')

    if (!alertId || !userId) {
      return NextResponse.json(
        { error: 'Missing alertId or userId query parameters' },
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

    // Check location_history entries
    const { data: locations, error: locationsError } = await admin
      .from('location_history')
      .select('*')
      .eq('alert_id', alertId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    // Check alert_responses
    const { data: response, error: responseError } = await admin
      .from('alert_responses')
      .select('*')
      .eq('alert_id', alertId)
      .eq('contact_user_id', userId)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      alertId,
      userId,
      locationHistory: {
        count: locations?.length || 0,
        locations: locations || [],
        error: locationsError ? {
          code: locationsError.code,
          message: locationsError.message
        } : null
      },
      alertResponse: {
        exists: !!response,
        data: response || null,
        hasAcknowledged: !!response?.acknowledged_at,
        acknowledgedAt: response?.acknowledged_at || null,
        hasDeclined: !!response?.declined_at,
        declinedAt: response?.declined_at || null,
        error: responseError ? {
          code: responseError.code,
          message: responseError.message
        } : null
      },
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('[DIAG] [API] Error in location-verification:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

