import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// Note: To use web-push, install: npm install web-push
// Then uncomment the web-push import and implementation below
// import webpush from 'web-push'

/**
 * Send push notification to a user
 * This endpoint is called internally when an emergency alert is created
 * Note: This is an internal API - authentication is handled by the caller
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Parse request body
    let body: {
      userId: string
      alertId: string
      title?: string
      body?: string
      data?: any
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const { userId, alertId, title, body: bodyText, data } = body

    if (!userId || !alertId) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, alertId' },
        { status: 400 }
      )
    }

    // Get push subscription for target user
    const admin = createAdminClient()
    const { data: subscription, error: subError } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh_key, auth_key')
      .eq('user_id', userId)
      .single()

    if (subError || !subscription) {
      // User doesn't have push enabled - this is OK, not an error
      return NextResponse.json(
        { success: false, message: 'User has not enabled push notifications' },
        { status: 200 }
      )
    }

    // Prepare notification payload
    const notificationPayload = JSON.stringify({
      title: title || 'Emergency Alert',
      body: bodyText || 'Someone in your contact list needs help!',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      tag: 'emergency-alert',
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200, 100, 200],
      data: {
        alertId,
        ...data,
      },
    })

    // Import web-push (should be installed via npm)
    let webpush: any
    try {
      webpush = require('web-push')
    } catch (error) {
      console.warn('[Push] web-push not available:', error)
      // Return success anyway - notification will be sent via Realtime
      return NextResponse.json(
        { success: false, message: 'web-push not configured' },
        { status: 200 }
      )
    }

    // Set VAPID keys from environment
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
    const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@example.com'

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.warn('[Push] VAPID keys not configured')
      return NextResponse.json(
        { success: false, message: 'VAPID keys not configured' },
        { status: 200 }
      )
    }

    webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey)

    // Send push notification
    // Keys are already base64 strings from database - pass directly to web-push
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh_key,
            auth: subscription.auth_key,
          },
        },
        notificationPayload
      )

      console.log(`[Push] Notification sent successfully to user ${userId}`)
      return NextResponse.json({ success: true }, { status: 200 })
    } catch (pushError: any) {
      // Handle specific push errors
      if (pushError.statusCode === 410) {
        // Subscription expired - delete it
        console.log(`[Push] Subscription expired for user ${userId}, deleting...`)
        await admin
          .from('push_subscriptions')
          .delete()
          .eq('user_id', userId)
      }
      console.error(`[Push] Failed to send notification to user ${userId}:`, pushError)
      return NextResponse.json(
        { success: false, error: pushError.message },
        { status: 200 }
      )
    }
  } catch (error: any) {
    console.error('Unexpected error sending push notification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

