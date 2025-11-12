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
  const requestStartTime = Date.now()
  try {
    console.log('[DIAG] [API] 📥 Checkpoint 6 - accepted-responders: Request received', {
      timestamp: new Date().toISOString(),
      url: request.url
    })
    
    // Get authenticated user
    const supabase = await createServerClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      console.error('[API] Authentication failed in accepted-responders:', {
        hasSession: !!session,
        hasUser: !!session?.user,
        errorCode: sessionError?.code,
        errorMessage: sessionError?.message
      })
      return NextResponse.json(
        { error: 'Unauthorized', details: sessionError?.message || 'No valid session' },
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
      const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
      const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL
      
      console.log('[API] Admin client environment check:', {
        hasServiceKey,
        hasUrl,
        alertId: alertId,
        userId: session.user.id
      })
      
      admin = createAdminClient()
      
      console.log('[API] ✅ Admin client created successfully')
    } catch (adminError: any) {
      console.error('[API] ❌ Failed to create admin client:', {
        error: adminError?.message || String(adminError),
        stack: adminError?.stack,
        alertId: alertId,
        envCheck: {
          hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
          hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL
        }
      })
      return NextResponse.json(
        { 
          error: 'Configuration error',
          details: 'Database admin access not configured. Please set SUPABASE_SERVICE_ROLE_KEY in environment variables.'
        },
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
      console.error('[API] ❌ Alert query error:', {
        error: alertError,
        code: alertError?.code,
        message: alertError?.message,
        details: alertError?.details,
        hint: alertError?.hint,
        alertId: alertId,
        userId: session.user.id
      })
      return NextResponse.json(
        { error: 'Alert not found', details: alertError?.message || 'Alert does not exist' },
        { status: 404 }
      )
    }
    
    console.log('[API] ✅ Alert found:', {
      alertId: alertId,
      alertOwnerId: alert.user_id,
      requestingUserId: session.user.id,
      isOwner: alert.user_id === session.user.id
    })

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
    // Only include users who have acknowledged AND not declined
    const { data: acceptedResponses, error: responsesError } = await admin
      .from('alert_responses')
      .select('contact_user_id, acknowledged_at, declined_at')
      .eq('alert_id', alertId)
      .not('acknowledged_at', 'is', null)
      .is('declined_at', null) // Exclude declined users
      .order('acknowledged_at', { ascending: false })

    if (responsesError) {
      console.error('[API] ❌ Error fetching accepted responders:', {
        code: responsesError.code,
        message: responsesError.message,
        details: responsesError.details,
        hint: responsesError.hint,
        alertId: alertId,
        userId: session.user.id
      })
      return NextResponse.json(
        { error: 'Failed to fetch accepted responders', details: responsesError.message || 'Database query failed' },
        { status: 500 }
      )
    }

    const totalDuration = Date.now() - requestStartTime
    console.log('[DIAG] [API] ✅ Checkpoint 6 - accepted-responders: Returning response', {
      alertId: alertId,
      count: acceptedResponses?.length || 0,
      responderIds: acceptedResponses?.map((r: any) => r.contact_user_id) || [],
      timestamp: new Date().toISOString(),
      totalDuration: `${totalDuration}ms`
    })

    return NextResponse.json(
      {
        success: true,
        acceptedResponders: acceptedResponses || [],
        count: acceptedResponses?.length || 0
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
    console.error('[API] Unexpected error in accepted-responders endpoint:', {
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

