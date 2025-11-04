'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/contexts/AuthContext'
import { registerDeviceForPush, isPushSupported, isPushEnabled } from '@/lib/push-notifications'

/**
 * Component to set up push notifications on app load
 */
export default function PushNotificationSetup() {
  const { user } = useAuth()
  const [pushEnabled, setPushEnabled] = useState(false)

  useEffect(() => {
    if (!user) return

    // Check if push is supported
    if (!isPushSupported()) {
      console.warn('[Push] Push notifications not supported in this browser')
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
              console.warn('[Push] Failed to enable push notifications')
            }
          })
          .catch((error) => {
            console.error('[Push] Error registering push:', error)
          })
      })
      .catch((error) => {
        console.error('[Push] Error checking push status:', error)
      })
  }, [user])

  return null // This component doesn't render anything
}

