'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/contexts/AuthContext'
import { registerDeviceForPush, isPushSupported, isPushEnabled } from '@/lib/push-notifications'

/**
 * Component to set up push notifications on app load
 * Wrapped in try-catch to prevent crashes
 */
export default function PushNotificationSetup() {
  const { user } = useAuth()
  const [pushEnabled, setPushEnabled] = useState(false)

  useEffect(() => {
    // Safety check - only run on client side
    if (typeof window === 'undefined') return
    
    // Safety check - only run if user is available
    if (!user) return

    try {
      // Check if push is supported
      if (!isPushSupported()) {
        // Silently return - push not supported is not an error
        return
      }

      // Check if already enabled
      isPushEnabled()
        .then((enabled) => {
          if (enabled) {
            setPushEnabled(true)
            return
          }

          // Register device for push notifications
          // Don't show error to user - just log it
          registerDeviceForPush()
            .then((success) => {
              if (success) {
                setPushEnabled(true)
                console.log('[Push] Push notifications enabled')
              } else {
                // Silently fail - push notifications are optional
                console.warn('[Push] Failed to enable push notifications')
              }
            })
            .catch((error) => {
              // Silently handle errors - push notifications are optional
              console.warn('[Push] Error registering push:', error)
            })
        })
        .catch((error) => {
          // Silently handle errors - push notifications are optional
          console.warn('[Push] Error checking push status:', error)
        })
    } catch (error) {
      // Silently handle any unexpected errors - don't crash the app
      console.warn('[Push] Unexpected error in PushNotificationSetup:', error)
    }
  }, [user])

  return null // This component doesn't render anything
}

