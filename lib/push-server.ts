/**
 * Server-side push notification utilities
 * Used by API routes to send push notifications
 */

import { createAdminClient } from './supabase'

interface PushNotificationData {
  alertId: string
  title?: string
  body?: string
  data?: any
}

/**
 * Send push notification to a user (server-side)
 */
export async function sendPushNotification(
  userId: string,
  notification: PushNotificationData
): Promise<void> {
  const admin = createAdminClient()

  // Get push subscription for user
  const { data: subscription, error: subError } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh_key, auth_key')
    .eq('user_id', userId)
    .single()

  if (subError || !subscription) {
    // User doesn't have push enabled - this is OK, not an error
    return
  }

  // Prepare notification payload
  const notificationPayload = JSON.stringify({
    title: notification.title || 'Emergency Alert',
    body: notification.body || 'Someone in your contact list needs help!',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: 'emergency-alert',
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200, 100, 200],
    data: {
      alertId: notification.alertId,
      ...notification.data,
    },
  })

  // Import web-push (should be installed via npm)
  let webpush: any
  try {
    webpush = require('web-push')
  } catch (error) {
    console.warn('[Push] web-push not available:', error)
    return
  }

  // Set VAPID keys from environment
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@example.com'

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('[Push] VAPID keys not configured')
    return
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
    throw pushError
  }
}

