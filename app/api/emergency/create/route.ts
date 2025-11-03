import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createEmergencyAlert, checkRateLimit, getEmergencyContacts } from '@/lib/emergency'

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

    // Parse request body with error handling
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const { alert_type = 'other', location } = body

    // Validate alert_type
    const validAlertTypes = ['robbery', 'house_breaking', 'car_jacking', 'accident', 'other']
    if (!validAlertTypes.includes(alert_type)) {
      return NextResponse.json(
        { error: `Invalid alert_type. Must be one of: ${validAlertTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate location if provided (must come from client)
    let validatedLocation: { lat: number; lng: number; address?: string } | undefined = undefined
    if (location) {
      if (typeof location.lat === 'number' && typeof location.lng === 'number') {
        // Validate lat/lng ranges
        if (location.lat >= -90 && location.lat <= 90 && location.lng >= -180 && location.lng <= 180) {
          validatedLocation = {
            lat: location.lat,
            lng: location.lng,
            address: location.address || undefined,
          }
        } else {
          console.warn('Invalid location coordinates provided')
        }
      } else {
        console.warn('Invalid location format provided')
      }
    }

    // Check rate limit
    try {
      const canCreate = await checkRateLimit(userId)
      if (!canCreate) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please wait 30 seconds.' },
          { status: 429 }
        )
      }
    } catch (rateLimitError: any) {
      console.error('Rate limit check error:', rateLimitError)
      // Continue - don't block on rate limit check error
    }

    // Create emergency alert
    let alert
    try {
      alert = await createEmergencyAlert(
        userId,
        alert_type as any,
        validatedLocation
      )
    } catch (alertError: any) {
      console.error('Failed to create emergency alert:', alertError)
      return NextResponse.json(
        { error: alertError.message || 'Failed to create emergency alert' },
        { status: 500 }
      )
    }

    // Get contacts and notify them (non-blocking)
    try {
      const contacts = await getEmergencyContacts(userId)
      if (contacts.length > 0) {
        const { notifyEmergencyContacts } = await import('@/lib/emergency')
        await notifyEmergencyContacts(alert.id, userId, contacts).catch((notifyError) => {
          console.error('Failed to notify contacts (non-critical):', notifyError)
          // Don't fail the request if notification fails
        })
      }
    } catch (contactError) {
      console.error('Failed to get contacts (non-critical):', contactError)
      // Continue even if contact notification fails
    }

    return NextResponse.json({ alert }, { status: 201 })
  } catch (error: any) {
    console.error('Unexpected error creating emergency alert:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

