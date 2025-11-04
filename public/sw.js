/**
 * Service Worker for PSP Emergency Notifications
 * Handles push notifications, background sync, and offline support
 */

// Service Worker version
const CACHE_VERSION = 'v1'
const CACHE_NAME = `psp-cache-${CACHE_VERSION}`

// Install Service Worker
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...')
  self.skipWaiting() // Activate immediately
})

// Activate Service Worker
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...')
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )
  return self.clients.claim() // Take control of all pages immediately
})

// Handle push notifications
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received:', event)

  let notificationData = {
    title: 'Emergency Alert',
    body: 'Someone in your contact list needs help!',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: 'emergency-alert',
    requireInteraction: true, // Don't auto-dismiss
    silent: false, // Make sound
    vibrate: [200, 100, 200, 100, 200, 100, 200], // Vibrate pattern
    data: {},
  }

  // Parse push data if available
  if (event.data) {
    try {
      const data = event.data.json()
      notificationData = {
        ...notificationData,
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        data: data,
      }
    } catch (e) {
      console.warn('[Service Worker] Failed to parse push data:', e)
      notificationData.body = event.data.text() || notificationData.body
    }
  }

  // Show notification
  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      ...notificationData,
      // Critical priority for maximum visibility and sound
      priority: 'high',
      // Use custom action for opening alert
      actions: [
        {
          action: 'view',
          title: 'View Alert',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    })
  )
})

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked:', event)
  
  event.notification.close()

  const notificationData = event.notification.data || {}
  const alertId = notificationData.alertId

  // Handle different actions
  if (event.action === 'dismiss') {
    // Just close the notification
    return
  }

  // Default action: open the alert page
  const urlToOpen = alertId
    ? `/emergency/active/${alertId}`
    : '/dashboard'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open with this URL
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus()
        }
      }
      // Open new window if none exists
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

// Handle background sync (for offline support)
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag)
  // Can be used for offline alert creation
})

// Fetch handler for offline support
self.addEventListener('fetch', (event) => {
  // Cache strategy can be added here if needed
  // For now, just pass through to network
})

