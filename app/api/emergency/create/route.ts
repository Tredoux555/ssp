import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

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
    const validAlertTypes = ['robbery', 'house_breaking', 'car_jacking', 'accident', 'other', 'life_or_death', 'need_a_hand']
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

    // Auto-cancel any existing active alerts before creating new one
    // This prevents old active alerts from blocking new emergency alerts
    const admin = createAdminClient()
    let cancelledCount = 0
    try {
      const { data: cancelledData, error: cancelError } = await admin
        .from('emergency_alerts')
        .update({ 
          status: 'cancelled', 
          resolved_at: new Date().toISOString() 
        })
        .eq('user_id', userId)
        .eq('status', 'active')
        .select('id')
      
      if (cancelError) {
        console.warn('Failed to auto-cancel old active alerts (non-critical):', cancelError)
        // Continue - don't block creation if cancel fails
      } else if (cancelledData) {
        cancelledCount = cancelledData.length
        console.log(`Auto-cancelled ${cancelledCount} old active alert(s) for user ${userId}`)
      }
    } catch (cancelErr) {
      console.warn('Error auto-cancelling old active alerts (non-critical):', cancelErr)
      // Continue - don't block creation
    }

    // Check rate limit - checks only active alerts (old ones were auto-cancelled above)
    // Use admin client for rate limit check (server-side) to bypass RLS
    try {
      const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString()
      
      // Check only ACTIVE alerts in last 30 seconds
      // Old active alerts were auto-cancelled above, so this only blocks if there's a recent active alert
      const { data: rateLimitData, error: rateLimitError } = await admin
        .from('emergency_alerts')
        .select('id, triggered_at')
        .eq('user_id', userId)
        .eq('status', 'active') // Only check active alerts
        .gte('triggered_at', thirtySecondsAgo)
        .limit(1)
      
      if (rateLimitError) {
        console.error('Rate limit check error:', rateLimitError)
        // Continue - don't block on rate limit check error
      } else if (rateLimitData && rateLimitData.length > 0) {
        // There's an active alert within 30 seconds - block creation
        console.log(`Rate limit blocked: Found ${rateLimitData.length} active alert(s) within 30 seconds for user ${userId}`)
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please wait 30 seconds.' },
          { status: 429 }
        )
      } else {
        console.log(`Rate limit check passed: No active alerts within 30 seconds for user ${userId} (cancelled ${cancelledCount} old alerts)`)
      }
    } catch (rateLimitError: any) {
      console.error('Rate limit check error:', rateLimitError)
      // Continue - don't block on rate limit check error
    }

    // Create emergency alert using admin client (server-side)
    // Fetch contacts BEFORE creating the alert so we can include them in the INSERT
    // This ensures Realtime subscriptions fire immediately on INSERT with contacts_notified
    let alert
    let contactIds: string[] = []
    try {
      const { data: contacts, error: contactsError } = await admin
        .from('emergency_contacts')
        .select('id, contact_user_id, email, phone, verified')
        .eq('user_id', userId)
        .eq('verified', true)

      if (contactsError) {
        console.error('Failed to fetch contacts before creating alert:', contactsError)
      } else if (contacts && contacts.length > 0) {
        contactIds = contacts
          .filter((c: any) => c.contact_user_id)
          .map((c: any) => String(c.contact_user_id).trim())
          .filter(Boolean)
        // Deduplicate
        contactIds = Array.from(new Set(contactIds))
      }

      const alertData: any = {
        user_id: userId,
        status: 'active',
        alert_type: alert_type,
      }

      if (validatedLocation) {
        alertData.location_lat = validatedLocation.lat
        alertData.location_lng = validatedLocation.lng
        if (validatedLocation.address) {
          alertData.address = validatedLocation.address
        }
      }

      if (contactIds.length > 0) {
        alertData.contacts_notified = contactIds
      }

      const { data: alertDataResult, error: alertError } = await admin
        .from('emergency_alerts')
        .insert(alertData)
        .select()
        .single()

      if (alertError || !alertDataResult) {
        console.error('Failed to create emergency alert:', alertError)
        return NextResponse.json(
          { error: alertError?.message || 'Failed to create emergency alert' },
          { status: 500 }
        )
      }

      alert = alertDataResult
    } catch (alertError: any) {
      console.error('Failed to create emergency alert:', alertError)
      return NextResponse.json(
        { error: alertError?.message || 'Failed to create emergency alert' },
        { status: 500 }
      )
    }

    // Get contacts and notify them (non-blocking)
    // Use admin client to bypass RLS for both getting contacts and creating alert responses
    try {
      // Get emergency contacts using admin client (bypasses RLS)
      const { data: contacts, error: contactsError } = await admin
        .from('emergency_contacts')
        .select('id, contact_user_id, email, phone, verified')
        .eq('user_id', userId)
        .eq('verified', true)
      
      if (contactsError) {
        console.error('Failed to get contacts:', contactsError)
        // Continue - don't block on contact fetch error
      } else if (contacts && contacts.length > 0) {
        // Filter and get contact USER IDs (not contact record IDs)
        // Only use contacts that have contact_user_id set (linked users)
        // Contacts without contact_user_id are just email/phone entries that haven't accepted invites
        const contactIds = contacts
          .filter(c => c.verified && c.contact_user_id) // Only verified contacts with linked user IDs
          .map(c => c.contact_user_id)
          .filter((id): id is string => !!id) // Filter out null/undefined and ensure type safety

        if (contactIds.length > 0) {
          // Update alert with notified contacts using admin client
          const { error: updateError } = await admin
            .from('emergency_alerts')
            .update({ contacts_notified: contactIds })
            .eq('id', alert.id)
            .eq('user_id', userId)
          
          if (updateError) {
            console.error('Failed to update alert with notified contacts:', updateError)
          } else {
            // Create alert responses for each contact using admin client (bypasses RLS)
            const responses = contactIds.map(contactId => ({
              alert_id: alert.id,
              contact_user_id: contactId,
            }))

            const { error: insertError } = await admin
              .from('alert_responses')
              .insert(responses)

            if (insertError) {
              console.error('Failed to create alert responses:', insertError)
              // Don't throw - alert is already updated with contacts
            } else {
              console.log(`Created ${responses.length} alert response(s) for alert ${alert.id}`)
            }
          }

          // Send push notifications to all contacts (non-blocking)
          // This runs in parallel with Realtime subscriptions
          try {
            // Use the same contact IDs that were used for Realtime notifications
            // This ensures push notifications go to the same users
            const contactUserIds = contactIds as string[]

            if (contactUserIds.length > 0) {
              // Import push send function directly (server-side)
              const { sendPushNotification } = await import('@/lib/push-server')
              
              // Send push notification to each contact in parallel
              // Don't wait for completion - fire and forget
              Promise.allSettled(
                contactUserIds.map(async (contactUserId) => {
                  try {
                    await sendPushNotification(contactUserId, {
                      alertId: alert.id,
                      title: 'Emergency Alert',
                      body: `Emergency alert from ${session.user.email || 'a contact'}`,
                      data: {
                        alertId: alert.id,
                        alertType: alert.alert_type,
                        address: alert.address,
                      },
                    })
                  } catch (pushError) {
                    console.warn(`Error sending push to user ${contactUserId}:`, pushError)
                  }
                })
              ).catch((err) => {
                console.warn('Error sending push notifications (non-critical):', err)
              })
            }
          } catch (pushError) {
            console.warn('Failed to send push notifications (non-critical):', pushError)
            // Continue - push notifications are non-critical
          }
        }
      }
    } catch (contactError) {
      console.error('Failed to notify contacts (non-critical):', contactError)
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

