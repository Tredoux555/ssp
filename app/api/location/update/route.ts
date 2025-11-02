import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    
    // Get authenticated user
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const body = await request.json()
    const { latitude, longitude, accuracy, alert_id } = body

    if (!latitude || !longitude) {
      return NextResponse.json(
        { error: 'Missing required fields: latitude, longitude' },
        { status: 400 }
      )
    }

    // Rate limit: max 1 update per 5 seconds
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString()
    const { data: recentUpdate } = await supabase
      .from('location_history')
      .select('id')
      .eq('user_id', userId)
      .eq('alert_id', alert_id || null)
      .gte('timestamp', fiveSecondsAgo)
      .limit(1)

    if (recentUpdate && recentUpdate.length > 0) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait 5 seconds.' },
        { status: 429 }
      )
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
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ location: data }, { status: 201 })
  } catch (error: any) {
    console.error('Error updating location:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update location' },
      { status: 500 }
    )
  }
}

