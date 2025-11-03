import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
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

    const userId = session.user.id

    // Parse request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const { latitude, longitude, accuracy, alert_id } = body

    // Validate required fields
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json(
        { error: 'Missing or invalid required fields: latitude and longitude must be numbers' },
        { status: 400 }
      )
    }

    // Validate latitude/longitude ranges
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json(
        { error: 'Invalid coordinates: latitude must be between -90 and 90, longitude between -180 and 180' },
        { status: 400 }
      )
    }

    // Rate limit: max 1 update per 5 seconds
    try {
      const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString()
      const { data: recentUpdate, error: rateLimitError } = await supabase
        .from('location_history')
        .select('id')
        .eq('user_id', userId)
        .eq('alert_id', alert_id || null)
        .gte('timestamp', fiveSecondsAgo)
        .limit(1)

      if (rateLimitError) {
        console.error('Rate limit check error:', rateLimitError)
        // Continue - don't block on rate limit check error
      } else if (recentUpdate && recentUpdate.length > 0) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please wait 5 seconds.' },
          { status: 429 }
        )
      }
    } catch (rateLimitCheckError) {
      console.error('Exception checking rate limit:', rateLimitCheckError)
      // Continue - don't block
    }

    // Insert location update
    const { data, error } = await supabase
      .from('location_history')
      .insert({
        user_id: userId,
        alert_id: alert_id || null,
        latitude,
        longitude,
        accuracy: accuracy || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error inserting location:', error)
      // Check for specific error types
      if (error.code === '42501' || error.message.includes('row-level security')) {
        return NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to update location' },
        { status: 500 }
      )
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to create location entry' },
        { status: 500 }
      )
    }

    return NextResponse.json({ location: data }, { status: 201 })
  } catch (error: any) {
    console.error('Unexpected error updating location:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

