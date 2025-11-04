/**
 * Location tracking utilities for emergency alerts
 */

export interface LocationCoordinates {
  lat: number
  lng: number
  accuracy?: number
}

/**
 * Get current location using browser Geolocation API
 * Returns null gracefully if permission denied or unavailable
 */
export async function getCurrentLocation(): Promise<LocationCoordinates | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      // Geolocation not supported - return null gracefully
      return resolve(null)
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy || undefined,
        })
      },
      (error) => {
        // Handle errors gracefully - don't throw, just return null
        // Only log unexpected errors (not permission denials)
        if (error.code !== error.PERMISSION_DENIED) {
          // Log only unexpected errors (timeout, unavailable)
          if (error.code === error.POSITION_UNAVAILABLE || error.code === error.TIMEOUT) {
            // These are expected in some cases - don't log as error
            // Just return null gracefully
          }
        }
        // Return null instead of throwing error
        // This allows the app to continue without location
        resolve(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      }
    )
  })
}

/**
 * Update location in database
 */
export async function updateLocation(
  userId: string,
  alertId: string | null,
  location: LocationCoordinates
): Promise<void> {
  try {
    const { createClient } = await import('./supabase')
    const supabase = createClient()

    if (!supabase) {
      console.warn('Supabase client not available for location update - skipping')
      return // Don't throw - location update is non-critical
    }

    const { error } = await supabase
      .from('location_history')
      .insert({
        user_id: userId,
        alert_id: alertId,
        latitude: location.lat,
        longitude: location.lng,
        accuracy: location.accuracy,
      })

    if (error) {
      console.error('Failed to update location:', error)
      // Don't throw - location update is non-critical, just log the error
      // This prevents location update failures from breaking the emergency alert flow
    }
  } catch (error: any) {
    // Network errors or other issues should not break the emergency alert
    console.error('Failed to update location:', error)
    // Don't throw - location update is non-critical
  }
}

/**
 * Start continuous location tracking during emergency
 */
export function startLocationTracking(
  userId: string,
  alertId: string,
  onLocationUpdate?: (location: LocationCoordinates) => void,
  interval: number = 10000 // 10 seconds default
): () => void {
  let trackingInterval: NodeJS.Timeout | null = null
  let isTracking = true

  const trackLocation = async () => {
    if (!isTracking) return

    try {
      const location = await getCurrentLocation()
      
      // Only update if location is available
      if (location) {
        // Update in database
        await updateLocation(userId, alertId, location)

        // Callback for real-time updates
        if (onLocationUpdate) {
          onLocationUpdate(location)
        }
      }
      // If location is null (permission denied/unavailable), just skip silently
      // Don't log errors - this is expected behavior
    } catch (error) {
      // Only log unexpected errors
      console.error('Location tracking error:', error)
    }
  }

  // Start tracking immediately
  trackLocation()

  // Continue tracking at interval
  trackingInterval = setInterval(trackLocation, interval)

  // Return stop function
  return () => {
    isTracking = false
    if (trackingInterval) {
      clearInterval(trackingInterval)
    }
  }
}

/**
 * Reverse geocode coordinates to address using Google Maps Geocoding API
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return null
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
    )
    const data = await response.json()

    if (data.status === 'OK' && data.results.length > 0) {
      return data.results[0].formatted_address
    }

    return null
  } catch (error) {
    console.error('Reverse geocoding error:', error)
    return null
  }
}

