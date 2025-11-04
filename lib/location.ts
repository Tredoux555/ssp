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
 */
export async function getCurrentLocation(): Promise<LocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'))
      return
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
        let errorMessage = 'Unable to get your location'
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location access in your browser settings.'
            break
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable. Please check your device settings.'
            break
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Please try again.'
            break
          default:
            errorMessage = `Geolocation error: ${error.message || 'Unknown error'}`
        }
        
        reject(new Error(errorMessage))
      },
      {
        enableHighAccuracy: true,
        timeout: 8000, // Reduced from 10000 to fail faster
        maximumAge: 60000, // Accept cached location if less than 1 minute old
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
      
      // Update in database
      await updateLocation(userId, alertId, location)

      // Callback for real-time updates
      if (onLocationUpdate) {
        onLocationUpdate(location)
      }
    } catch (error) {
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

