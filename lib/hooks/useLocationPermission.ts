'use client'

import { useState, useEffect } from 'react'

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported'

/**
 * Hook to check and request location permission
 */
export function useLocationPermission() {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('prompt')
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    checkPermission()
  }, [])

  const checkPermission = async () => {
    setIsChecking(true)
    
    try {
      if (!navigator.geolocation) {
        setPermissionStatus('unsupported')
        setIsChecking(false)
        return
      }

      // Check if Permissions API is available (modern browsers)
      if ('permissions' in navigator) {
        try {
          const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
          setPermissionStatus(result.state as PermissionStatus)
          setIsChecking(false)
          
          // Listen for permission changes
          result.onchange = () => {
            setPermissionStatus(result.state as PermissionStatus)
          }
          return
        } catch (error) {
          // Permissions API might not be fully supported, fall through to test method
        }
      }

      // Fallback: Try to get position to test permission
      // This will trigger permission prompt if not already granted/denied
      navigator.geolocation.getCurrentPosition(
        () => {
          setPermissionStatus('granted')
          setIsChecking(false)
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setPermissionStatus('denied')
          } else if (error.code === error.TIMEOUT) {
            // Timeout doesn't mean permission is denied - user might need to allow in browser settings
            setPermissionStatus('prompt')
          } else {
            // POSITION_UNAVAILABLE or other errors - treat as prompt
            setPermissionStatus('prompt')
          }
          setIsChecking(false)
        },
        { timeout: 5000, maximumAge: 0 }
      )
    } catch (error) {
      console.warn('Error checking location permission:', error)
      setPermissionStatus('prompt')
      setIsChecking(false)
    }
  }

  const requestPermission = async (): Promise<PermissionStatus> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        setPermissionStatus('unsupported')
        resolve('unsupported')
        return
      }

      // Try to request permission by attempting to get position
      navigator.geolocation.getCurrentPosition(
        () => {
          setPermissionStatus('granted')
          resolve('granted')
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setPermissionStatus('denied')
            resolve('denied')
          } else if (error.code === error.TIMEOUT) {
            // Timeout - location request took too long
            // This could mean permission is pending or GPS is unavailable
            setPermissionStatus('prompt')
            resolve('prompt')
          } else {
            // POSITION_UNAVAILABLE or other errors
            setPermissionStatus('prompt')
            resolve('prompt')
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
    })
  }

  return {
    permissionStatus,
    isChecking,
    checkPermission,
    requestPermission,
  }
}

/**
 * Standalone function to check location permission status
 */
export async function checkLocationPermission(): Promise<PermissionStatus> {
  if (!navigator.geolocation) {
    return 'unsupported'
  }

  try {
    if ('permissions' in navigator) {
      const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      return result.state as PermissionStatus
    }
  } catch (error) {
    // Permissions API not available, fall through
  }

  // Fallback: return 'prompt' if we can't determine
  return 'prompt'
}

