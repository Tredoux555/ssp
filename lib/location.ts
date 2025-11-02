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
        reject(new Error(`Geolocation error: ${error.message}`))
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
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
  const { createClient } = await import('./supabase')
  const supabase = createClient()

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
    throw new Error(`Failed to update location: ${error.message}`)
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

