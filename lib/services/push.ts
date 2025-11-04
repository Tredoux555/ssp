'use client'

import { createClient } from '@/lib/supabase'
import { PushNotifications } from '@capacitor/push-notifications'
import { Capacitor } from '@capacitor/core'

/**
 * Request push notification permissions
 */
export async function requestPushPermission(): Promise<boolean> {
  try {
    const isNative = Capacitor.isNativePlatform()
    
    if (isNative) {
      // Use Capacitor Push Notifications on native platforms
      const result = await PushNotifications.requestPermissions()
      return result.receive === 'granted'
    } else {
      // Use browser Notification API on web
      if (!('Notification' in window)) {
        console.warn('This browser does not support notifications')
        return false
      }

      const permission = await Notification.requestPermission()
      return permission === 'granted'
    }
  } catch (error) {
    console.error('Failed to request push permission:', error)
    return false
  }
}

/**
 * Register device for push notifications (client-side replacement for /api/push/register)
 */
export async function registerDeviceForPush(): Promise<boolean> {
  try {
    const permission = await requestPushPermission()
    if (!permission) {
      console.warn('[Push] Notification permission not granted')
      return false
    }

    const isNative = Capacitor.isNativePlatform()
    
    if (isNative) {
      // Use Capacitor Push Notifications on native platforms
      await PushNotifications.register()
      
      // Set up listeners
      PushNotifications.addListener('registration', async (token) => {
        console.log('[Push] Registration token:', token.value)
        await savePushToken(token.value)
      })

      PushNotifications.addListener('registrationError', (error) => {
        console.error('[Push] Registration error:', error)
      })

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[Push] Notification received:', notification)
        // Handle notification - show alert, play sound, etc.
        handlePushNotification(notification)
      })

      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('[Push] Notification action performed:', notification)
        // Handle notification tap - navigate to alert, etc.
        handlePushNotificationTap(notification)
      })

      return true
    } else {
      // Use browser Service Worker for web push
      if (!('serviceWorker' in navigator)) {
        console.warn('[Push] Service Worker not supported')
        return false
      }

      // Register Service Worker
      const registration = await navigator.serviceWorker.register('/sw.js')
      if (!registration) {
        console.error('[Push] Failed to register Service Worker')
        return false
      }

      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        // Subscribe to push
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidPublicKey) {
          console.error('[Push] VAPID public key not configured')
          return false
        }

        // Convert VAPID key to Uint8Array
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
        })
      }

      if (!subscription) {
        console.error('[Push] Failed to subscribe to push')
        return false
      }

      // Save subscription to database
      await savePushSubscription(subscription)
      return true
    }
  } catch (error) {
    console.error('[Push] Error registering device:', error)
    return false
  }
}

/**
 * Save push token to database (for native platforms)
 */
async function savePushToken(token: string): Promise<void> {
  const supabase = createClient()
  
  if (!supabase) {
    console.error('[Push] Supabase client not available')
    return
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    console.error('[Push] Not authenticated')
    return
  }

  // Store token in push_subscriptions table
  // For native platforms, we store the token directly
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id: session.user.id,
      endpoint: `native:${token}`, // Prefix to identify native tokens
      p256dh_key: '', // Not used for native
      auth_key: '', // Not used for native
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })

  if (error) {
    console.error('[Push] Failed to save token:', error)
  }
}

/**
 * Save push subscription to database (for web platforms)
 */
async function savePushSubscription(subscription: PushSubscription): Promise<void> {
  const supabase = createClient()
  
  if (!supabase) {
    console.error('[Push] Supabase client not available')
    return
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    console.error('[Push] Not authenticated')
    return
  }

  // Convert subscription to database format
  const subscriptionData = {
    user_id: session.user.id,
    endpoint: subscription.endpoint,
    p256dh_key: arrayBufferToBase64(subscription.getKey('p256dh')!),
    auth_key: arrayBufferToBase64(subscription.getKey('auth')!),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(subscriptionData, {
      onConflict: 'user_id',
    })

  if (error) {
    console.error('[Push] Failed to save subscription:', error)
  }
}

/**
 * Send push notification to a user (for server-side use)
 * Note: This is typically called from server-side code, but included here for completeness
 */
export async function sendPushNotification(
  userId: string,
  notification: {
    alertId: string
    title: string
    body: string
    data?: any
  }
): Promise<void> {
  // This would typically be called from server-side code
  // For client-side, we can't directly send push notifications
  // Push notifications must be sent from a server using the stored subscription
  console.warn('[Push] sendPushNotification called from client - this should be server-side')
}

/**
 * Handle push notification received
 */
function handlePushNotification(notification: any): void {
  // Show notification, play sound, vibrate, etc.
  if (notification.data?.alertId) {
    // Navigate to alert page
    if (typeof window !== 'undefined') {
      window.location.href = `/alert/${notification.data.alertId}`
    }
  }
}

/**
 * Handle push notification tap
 */
function handlePushNotificationTap(notification: any): void {
  // Navigate to alert page when notification is tapped
  if (notification.notification?.data?.alertId) {
    if (typeof window !== 'undefined') {
      window.location.href = `/alert/${notification.notification.data.alertId}`
    }
  }
}

/**
 * Helper: Convert base64 URL to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

/**
 * Helper: Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

