import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'
import { createEmergencyAlert, checkRateLimit, getEmergencyContacts } from '@/lib/emergency'
import { getCurrentLocation, reverseGeocode } from '@/lib/location'

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
    const { alert_type = 'other' } = body

    // Check rate limit
    const canCreate = await checkRateLimit(userId)
    if (!canCreate) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait 30 seconds.' },
        { status: 429 }
      )
    }

    // Get current location
    let location
    try {
      const coords = await getCurrentLocation()
      const address = await reverseGeocode(coords.lat, coords.lng)
      location = {
        lat: coords.lat,
        lng: coords.lng,
        address: address || undefined,
      }
    } catch (error) {
      console.error('Failed to get location:', error)
      // Continue without location
    }

    // Create emergency alert
    const alert = await createEmergencyAlert(
      userId,
      alert_type as any,
      location
    )

    // Get contacts and notify them
    const contacts = await getEmergencyContacts(userId)
    if (contacts.length > 0) {
      const { notifyEmergencyContacts } = await import('@/lib/emergency')
      await notifyEmergencyContacts(alert.id, userId, contacts)
    }

    return NextResponse.json({ alert }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating emergency alert:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create emergency alert' },
      { status: 500 }
    )
  }
}

