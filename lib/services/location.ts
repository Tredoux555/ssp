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
 * Confirm location explicitly (manual confirmation - bypasses rate limit)
 * This is used when the user explicitly clicks "Confirm Location" button
 */
export async function confirmLocation(
  userId: string,
  alertId: string,
  location: { lat: number; lng: number; accuracy?: number }
): Promise<void> {
  const supabase = createClient()
  
  if (!supabase) {
    console.error('Supabase client not available for location confirmation')
    return
  }

  try {
    // Insert location update immediately (no rate limit check for manual confirmations)
    const locationData: any = {
      user_id: userId,
      alert_id: alertId,
      latitude: location.lat,
      longitude: location.lng,
      created_at: new Date().toISOString(),
    }

    if (location.accuracy) {
      locationData.accuracy = location.accuracy
    }

    const { error } = await supabase
      .from('location_history')
      .insert(locationData)

    if (error) {
      console.error('Failed to confirm location:', error)
      throw error // Throw for manual confirmations so UI can show error
    }
    
    // Also update the alert's initial location for reference
    const { error: updateError } = await supabase
      .from('emergency_alerts')
      .update({
        location_lat: location.lat,
        location_lng: location.lng,
      })
      .eq('id', alertId)
      .eq('user_id', userId) // Ensure user owns the alert
    
    if (updateError) {
      console.warn('Failed to update alert location (non-critical):', updateError)
      // Don't throw - location_history update succeeded
    }
  } catch (error) {
    console.error('Failed to confirm location:', error)
    throw error // Re-throw so caller can handle
  }
}

/**
 * Update location in database (client-side replacement for /api/location/update)
 * Rate limited for automatic updates
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
    // Rate limit: max 1 update per 5 seconds per user per alert
    // This allows sender and receiver to update independently
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString()
    
    if (alertId) {
      // Check if THIS USER has updated this alert's location recently
      const { data: recentUpdate } = await supabase
        .from('location_history')
        .select('id')
        .eq('alert_id', alertId)
        .eq('user_id', userId) // Check per user, not per alert
        .gte('created_at', fiveSecondsAgo)
        .limit(1)
        .maybeSingle()

      if (recentUpdate) {
        // Skip update - too soon for this user
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

