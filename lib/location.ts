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
        timeout: 15000,
        maximumAge: 0,
      }
    )
  })
}

/**
 * Update location in database
 * Uses the location service which handles rate limiting
 */
export async function updateLocation(
  userId: string,
  alertId: string | null,
  location: LocationCoordinates
): Promise<void> {
  try {
    const { updateLocation: updateLocationService } = await import('./services/location')
    await updateLocationService(userId, alertId, location)
  } catch (error: any) {
    // Network errors or other issues should not break the emergency alert
    console.error('Failed to update location:', error)
    // Don't throw - location update is non-critical
  }
}

/**
 * Start continuous location tracking during emergency
 * Uses Capacitor Geolocation on native platforms, browser API on web
 */
export function startLocationTracking(
  userId: string,
  alertId: string,
  onLocationUpdate?: (location: LocationCoordinates) => void,
  interval: number = 10000 // 10 seconds default
): () => void {
  let trackingInterval: NodeJS.Timeout | null = null
  let watchId: string | null = null
  let isTracking = true

  const trackLocation = async () => {
    if (!isTracking) return

    try {
      // Use location service which handles Capacitor vs browser
      const { getCurrentLocation } = await import('./services/location')
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
    } catch (error) {
      // Only log unexpected errors
      console.error('Location tracking error:', error)
    }
  }

  // Try to use watchPosition for more efficient tracking (if available)
  const setupWatch = async () => {
    try {
      const { watchPosition, clearWatch } = await import('./services/location')
      const id = await watchPosition((location) => {
        if (!isTracking) return
        
        // Update in database
        updateLocation(userId, alertId, location).catch(err => {
          console.error('Failed to update location:', err)
        })

        // Callback for real-time updates
        if (onLocationUpdate) {
          onLocationUpdate(location)
        }
      })
      
      if (id) {
        watchId = id
        // Also set up interval as fallback
        trackingInterval = setInterval(trackLocation, interval)
        return
      }
    } catch (error) {
      console.warn('Watch position not available, using interval:', error)
    }
    
    // Fallback to interval-based tracking
    trackLocation()
    trackingInterval = setInterval(trackLocation, interval)
  }

  setupWatch()

  // Return stop function
  return () => {
    isTracking = false
    if (trackingInterval) {
      clearInterval(trackingInterval)
    }
    if (watchId) {
      import('./services/location').then(({ clearWatch }) => {
        clearWatch(watchId!).catch(err => {
          console.warn('Failed to clear watch:', err)
        })
      })
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
    // Add timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`,
      { signal: controller.signal }
    )
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      // Network error or API error - don't log as error, just return null
      return null
    }

    const data = await response.json()

    if (data.status === 'OK' && data.results.length > 0) {
      return data.results[0].formatted_address
    }

    // API returned non-OK status (e.g., ZERO_RESULTS, OVER_QUERY_LIMIT)
    // Don't log as error - this is expected in some cases
    return null
  } catch (error: any) {
    // Only log unexpected errors, not network/timeout errors
    if (error.name === 'AbortError' || error.message?.includes('Load failed') || error.message?.includes('fetch')) {
      // Network/timeout errors are expected - don't log
      return null
    }
    // Unexpected errors - log as warning, not error
    console.warn('Reverse geocoding issue (non-critical):', error)
    return null
  }
}

