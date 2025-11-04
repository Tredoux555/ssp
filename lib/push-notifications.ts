/**
 * Push Notification Client
 * Handles registration, permission requests, and notification display
 */

interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications')
    return 'denied'
  }

  if (Notification.permission === 'granted') {
    return 'granted'
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission()
    return permission
  }

  return Notification.permission
}

/**
 * Register Service Worker
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('This browser does not support service workers')
    return null
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    })
    console.log('[Push] Service Worker registered:', registration)
    return registration
  } catch (error) {
    console.error('[Push] Service Worker registration failed:', error)
    return null
  }
}

/**
 * Get push subscription
 */
export async function getPushSubscription(
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> {
  try {
    const subscription = await registration.pushManager.getSubscription()
    return subscription
  } catch (error) {
    console.error('[Push] Failed to get subscription:', error)
    return null
  }
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPush(
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> {
  try {
    // Check if we need to generate VAPID keys
    // For now, we'll use a placeholder - this should be replaced with actual VAPID keys
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

    if (!vapidPublicKey) {
      console.warn('[Push] VAPID public key not configured')
      return null
    }

    // Convert VAPID key to Uint8Array
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // PushSubscriptionOptions accepts Uint8Array directly - no cast needed
      applicationServerKey: applicationServerKey as unknown as ArrayBuffer,
    })

    console.log('[Push] Subscribed to push notifications:', subscription)
    return subscription
  } catch (error) {
    console.error('[Push] Failed to subscribe to push:', error)
    return null
  }
}

/**
 * Register device for push notifications
 */
export async function registerDeviceForPush(): Promise<boolean> {
  try {
    // Request permission first
    const permission = await requestNotificationPermission()
    if (permission !== 'granted') {
      console.warn('[Push] Notification permission not granted:', permission)
      return false
    }

    // Register Service Worker
    const registration = await registerServiceWorker()
    if (!registration) {
      console.error('[Push] Failed to register Service Worker')
      return false
    }

    // Check if already subscribed
    let subscription = await getPushSubscription(registration)
    if (!subscription) {
      // Subscribe to push
      subscription = await subscribeToPush(registration)
      if (!subscription) {
        console.error('[Push] Failed to subscribe to push')
        return false
      }
    }

    // Send subscription to server
    const subscriptionData = subscriptionToJSON(subscription)
    const response = await fetch('/api/push/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscriptionData),
    })

    if (!response.ok) {
      console.error('[Push] Failed to register device:', response.statusText)
      return false
    }

    console.log('[Push] Device registered successfully')
    return true
  } catch (error) {
    console.error('[Push] Error registering device:', error)
    return false
  }
}

/**
 * Convert subscription to JSON format
 */
function subscriptionToJSON(subscription: PushSubscription): PushSubscriptionData {
  const key = subscription.getKey('p256dh')
  const auth = subscription.getKey('auth')

  if (!key || !auth) {
    throw new Error('Subscription keys not available')
  }

  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: arrayBufferToBase64(key),
      auth: arrayBufferToBase64(auth),
    },
  }
}

/**
 * Convert base64 URL to Uint8Array
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
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

/**
 * Check if push notifications are supported
 */
export function isPushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * Check if push notifications are enabled
 */
export async function isPushEnabled(): Promise<boolean> {
  if (!isPushSupported()) {
    return false
  }

  const permission = Notification.permission
  if (permission !== 'granted') {
    return false
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription !== null
  } catch {
    return false
  }
}

