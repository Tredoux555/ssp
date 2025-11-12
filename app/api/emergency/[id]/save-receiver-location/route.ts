import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const requestStartTime = Date.now()
  try {
    console.log('[DIAG] [API] 📥 save-receiver-location: Request received', {
      timestamp: new Date().toISOString(),
      url: request.url
    })

    const supabase = await createServerClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      console.log('[DIAG] [API] ❌ save-receiver-location: Unauthorized', {
        hasSession: !!session,
        hasUser: !!session?.user,
        error: sessionError?.message,
        timestamp: new Date().toISOString()
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    const alertId = params.id
    const body = await request.json()
    const { lat, lng, accuracy } = body

    console.log('[DIAG] [API] 📥 save-receiver-location: Request details', {
      alertId: alertId,
      userId: session.user.id,
      hasLat: !!lat,
      hasLng: !!lng,
      timestamp: new Date().toISOString()
    })

    if (!lat || !lng || !alertId) {
      return NextResponse.json({ 
        error: 'Missing required fields',
        details: { hasLat: !!lat, hasLng: !!lng, hasAlertId: !!alertId }
      }, { status: 400 })
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

    // Verify user has accepted to respond (using admin client to bypass RLS)
    // CRITICAL FIX: Add retry logic to handle race condition (acceptance might not be committed yet)
    let response: any = null
    let responseError: any = null
    let retryCount = 0
    const maxRetries = 3
    
    while (retryCount < maxRetries) {
      const { data, error } = await admin
        .from('alert_responses')
        .select('acknowledged_at, declined_at')
        .eq('alert_id', alertId)
        .eq('contact_user_id', session.user.id)
        .single()
      
      response = data
      responseError = error
      
      // If we got a response and it's accepted, break
      if (response && response.acknowledged_at && !response.declined_at) {
        break
      }
      
      // If error is not "not found" or we're on last retry, break
      if (responseError && responseError.code !== 'PGRST116' && retryCount === maxRetries - 1) {
        break
      }
      
      // Wait before retry (race condition - acceptance might not be committed yet)
      if (retryCount < maxRetries - 1) {
        console.log('[DIAG] [API] ⏳ Retrying acceptance check (race condition?)', {
          attempt: retryCount + 1,
          maxRetries: maxRetries,
          alertId: alertId,
          userId: session.user.id
        })
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      
      retryCount++
    }

    if (responseError || !response) {
      console.log('[DIAG] [API] ❌ save-receiver-location: User has not accepted', {
        error: responseError?.message,
        hasResponse: !!response,
        alertId: alertId,
        userId: session.user.id,
        retries: retryCount,
        timestamp: new Date().toISOString()
      })
      return NextResponse.json({ 
        error: 'User has not accepted to respond',
        details: responseError?.message || 'No response found'
      }, { status: 403 })
    }

    if (response.declined_at) {
      console.log('[DIAG] [API] ❌ save-receiver-location: User has declined', {
        alertId: alertId,
        userId: session.user.id,
        timestamp: new Date().toISOString()
      })
      return NextResponse.json({ error: 'User has declined to respond' }, { status: 403 })
    }

    if (!response.acknowledged_at) {
      console.log('[DIAG] [API] ❌ save-receiver-location: User has not acknowledged', {
        alertId: alertId,
        userId: session.user.id,
        timestamp: new Date().toISOString()
      })
      return NextResponse.json({ error: 'User has not accepted to respond' }, { status: 403 })
    }

    console.log('[DIAG] [API] ✅ save-receiver-location: User accepted, saving location', {
      alertId: alertId,
      userId: session.user.id,
      location: { lat, lng, accuracy },
      timestamp: new Date().toISOString()
    })

    // Save location using admin client (bypasses RLS)
    const locationData: any = {
      user_id: session.user.id,
      alert_id: alertId,
      latitude: lat,
      longitude: lng,
      created_at: new Date().toISOString(),
    }

    if (accuracy) {
      locationData.accuracy = accuracy
    }

    const { data, error } = await admin
      .from('location_history')
      .insert(locationData)
      .select()
      .single()

    if (error) {
      console.error('[DIAG] [API] ❌ save-receiver-location: Failed to save location', {
        error: error,
        code: error.code,
        message: error.message,
        alertId: alertId,
        userId: session.user.id,
        timestamp: new Date().toISOString()
      })
      return NextResponse.json({ 
        error: 'Failed to save location',
        details: error.message || 'Database insert failed'
      }, { status: 500 })
    }

    const totalDuration = Date.now() - requestStartTime
    console.log('[DIAG] [API] ✅ save-receiver-location: Location saved successfully', {
      locationId: data?.id,
      alertId: alertId,
      userId: session.user.id,
      location: { lat, lng, accuracy },
      timestamp: new Date().toISOString(),
      totalDuration: `${totalDuration}ms`
    })

    return NextResponse.json({ 
      success: true, 
      location: data,
      timestamp: new Date().toISOString()
    }, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error: any) {
    console.error('[DIAG] [API] ❌ save-receiver-location: Unexpected error', {
      error: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      timestamp: new Date().toISOString()
    })
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error?.message || 'An unexpected error occurred' 
    }, { status: 500 })
  }
}

