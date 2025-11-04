'use client'

import { createClient } from '@/lib/supabase'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'

/**
 * Get current location using Capacitor Geolocation (works on mobile and web)
 */
export async function getCurrentLocation(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  try {
    // Check if running on native platform
    const isNative = Capacitor.isNativePlatform()
    
    if (isNative) {
      // Use Capacitor Geolocation on native platforms
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      })
      
      return {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }
    } else {
      // Use browser Geolocation API on web
      if (!navigator.geolocation) {
        console.warn('Geolocation is not supported by this browser')
        return null
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null)
        }, 10000)

        navigator.geolocation.getCurrentPosition(
          (position) => {
            clearTimeout(timeout)
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
            })
          },
          (error) => {
            clearTimeout(timeout)
            console.warn('Geolocation error:', error)
            resolve(null)
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          }
        )
      })
    }
  } catch (error) {
    console.warn('Failed to get location:', error)
    return null
  }
}

/**
 * Watch position updates using Capacitor Geolocation
 */
export async function watchPosition(
  callback: (position: { lat: number; lng: number; accuracy?: number }) => void
): Promise<string | null> {
  try {
    const isNative = Capacitor.isNativePlatform()
    
    if (isNative) {
      // Use Capacitor Geolocation on native platforms
      const watchId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          timeout: 10000,
        },
        (position, err) => {
          if (err) {
            console.warn('Position watch error:', err)
            return
          }
          if (!position) {
            console.warn('Position is null')
            return
          }
          callback({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          })
        }
      )
      
      return watchId
    } else {
      // Use browser Geolocation API on web
      if (!navigator.geolocation) {
        console.warn('Geolocation is not supported by this browser')
        return null
      }

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          callback({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          })
        },
        (error) => {
          console.warn('Geolocation watch error:', error)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000,
        }
      )

      return watchId.toString()
    }
  } catch (error) {
    console.warn('Failed to watch position:', error)
    return null
  }
}

/**
 * Clear position watch
 */
export async function clearWatch(watchId: string): Promise<void> {
  try {
    const isNative = Capacitor.isNativePlatform()
    
    if (isNative) {
      await Geolocation.clearWatch({ id: watchId })
    } else {
      navigator.geolocation.clearWatch(parseInt(watchId))
    }
  } catch (error) {
    console.warn('Failed to clear watch:', error)
  }
}

/**
 * Update location in database (client-side replacement for /api/location/update)
 */
export async function updateLocation(
  userId: string,
  alertId: string | null,
  location: { lat: number; lng: number; accuracy?: number }
): Promise<void> {
  const supabase = createClient()
  
  if (!supabase) {
    console.error('Supabase client not available for location update')
    return
  }

  try {
    // Rate limit: max 1 update per 5 seconds per alert
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString()
    
    if (alertId) {
      // Check if we've updated this alert's location recently
      const { data: recentUpdate } = await supabase
        .from('location_history')
        .select('id')
        .eq('alert_id', alertId)
        .gte('created_at', fiveSecondsAgo)
        .limit(1)
        .maybeSingle()

      if (recentUpdate) {
        // Skip update - too soon
        return
      }
    }

    // Insert location update
    const locationData: any = {
      user_id: userId,
      latitude: location.lat,
      longitude: location.lng,
      created_at: new Date().toISOString(),
    }

    if (alertId) {
      locationData.alert_id = alertId
    }

    if (location.accuracy) {
      locationData.accuracy = location.accuracy
    }

    const { error } = await supabase
      .from('location_history')
      .insert(locationData)

    if (error) {
      console.error('Failed to update location:', error)
      // Don't throw - location updates are non-critical
    }
  } catch (error) {
    console.error('Failed to update location:', error)
    // Don't throw - location updates are non-critical
  }
}

