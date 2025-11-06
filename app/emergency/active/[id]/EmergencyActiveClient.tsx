'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { getActiveEmergency } from '@/lib/emergency'
import { startLocationTracking, getCurrentLocation, reverseGeocode } from '@/lib/location'
import { createClient } from '@/lib/supabase'
import { subscribeToLocationHistory } from '@/lib/realtime/subscriptions'
import { EmergencyAlert, LocationHistory } from '@/types/database'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { AlertTriangle, X, MapPin } from 'lucide-react'
import dynamic from 'next/dynamic'
import LocationPermissionPrompt from '@/components/LocationPermissionPrompt'
import { useLocationPermission } from '@/lib/hooks/useLocationPermission'

// Dynamically import Google Maps to avoid SSR issues
const GoogleMapComponent = dynamic(
  () => import('@/components/EmergencyMap'),
  { ssr: false }
)

// Client component - dynamic params handled by layout.tsx

export default function EmergencyActivePage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const alertId = params.id as string
  const [alert, setAlert] = useState<EmergencyAlert | null>(null)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [address, setAddress] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [locationTrackingActive, setLocationTrackingActive] = useState(false)
  const [lastLocationUpdate, setLastLocationUpdate] = useState<Date | null>(null)
  const [receiverLocations, setReceiverLocations] = useState<Map<string, LocationHistory[]>>(new Map())
  const [receiverUserIds, setReceiverUserIds] = useState<string[]>([])
  const { permissionStatus, requestPermission } = useLocationPermission()
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)

  useEffect(() => {
    if (!user) return

    loadAlert()
  }, [user, alertId])

  useEffect(() => {
    if (!alert || !user) return

    // Check location permission before starting tracking
    if (permissionStatus === 'denied' || permissionStatus === 'prompt') {
      setShowPermissionPrompt(true)
    } else if (permissionStatus === 'granted') {
      setShowPermissionPrompt(false)
    }

    // Query all receiver locations from location_history
    const loadReceiverLocations = async () => {
      try {
        const supabase = createClient()
        if (!supabase) return

        // Get all locations for this alert where user_id != sender.user_id
        const { data: allLocations, error } = await supabase
          .from('location_history')
          .select('*')
          .eq('alert_id', alert.id)
          .neq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50)

        if (error) {
          console.warn('[Sender] Failed to load receiver locations:', error)
          return
        }

        if (allLocations && allLocations.length > 0) {
          // Group locations by receiver user_id
          const receiverMap = new Map<string, LocationHistory[]>()
          const userIds = new Set<string>()

          allLocations.forEach((loc: LocationHistory) => {
            const receiverId = loc.user_id
            userIds.add(receiverId)
            
            if (!receiverMap.has(receiverId)) {
              receiverMap.set(receiverId, [])
            }
            receiverMap.get(receiverId)!.push(loc)
          })

          setReceiverLocations(receiverMap)
          setReceiverUserIds(Array.from(userIds))
        }
      } catch (error) {
        console.warn('[Sender] Error loading receiver locations:', error)
      }
    }

    loadReceiverLocations()

    // Subscribe to receiver location updates
    const unsubscribeReceiverLocations = subscribeToLocationHistory(alert.id, (newLocation) => {
      // Only process receiver locations (not sender's own location)
      if (newLocation.user_id !== user.id) {
        setReceiverLocations((prev) => {
          const updated = new Map(prev)
          const receiverId = newLocation.user_id
          
          if (!updated.has(receiverId)) {
            updated.set(receiverId, [])
            setReceiverUserIds((prevIds) => {
              if (!prevIds.includes(receiverId)) {
                return [...prevIds, receiverId]
              }
              return prevIds
            })
          }
          
          updated.get(receiverId)!.push(newLocation)
          return updated
        })
      }
    })

    // Start location tracking
    const stopTracking = startLocationTracking(
      user.id,
      alert.id,
      async (loc) => {
        setLocation(loc)
        setLastLocationUpdate(new Date())
        setLocationTrackingActive(true)
        if (!address && loc) {
          try {
            const addr = await reverseGeocode(loc.lat, loc.lng)
            if (addr) setAddress(addr)
          } catch (error) {
            // Reverse geocoding failed - that's ok, continue without address
            // Don't log - reverseGeocode already handles errors silently
          }
        }
      },
      20000 // Update every 20 seconds
    )
    
    setLocationTrackingActive(true)

    // Get initial location - use alert location as fallback
    getCurrentLocation()
      .then(async (loc) => {
        if (loc) {
          setLocation(loc)
          try {
            const addr = await reverseGeocode(loc.lat, loc.lng)
            if (addr) setAddress(addr)
          } catch (error) {
            // Reverse geocoding failed - that's ok, continue without address
          }
        } else {
          // Location unavailable - use alert location from database as fallback
          if (alert.location_lat && alert.location_lng) {
            setLocation({
              lat: alert.location_lat,
              lng: alert.location_lng,
            })
            if (alert.address) {
              setAddress(alert.address)
            } else {
              try {
                const addr = await reverseGeocode(alert.location_lat, alert.location_lng)
                if (addr) setAddress(addr)
              } catch (error) {
                // Reverse geocoding failed - that's ok, continue without address
              }
            }
          }
        }
      })
      .catch(() => {
        // Location failed - use alert location as fallback
        if (alert.location_lat && alert.location_lng) {
          setLocation({
            lat: alert.location_lat,
            lng: alert.location_lng,
          })
          if (alert.address) {
            setAddress(alert.address)
          }
        }
      })

    // Play alert sound (requires user interaction in modern browsers)
    // Handle missing audio file gracefully
    let audio: HTMLAudioElement | null = null
    let audioLoaded = false
    
    try {
      const audioPath = '/emergency-alert.mp3'
      audio = new Audio(audioPath)
      audio.loop = true
      audio.volume = 1.0
      
      // Handle audio loading errors (404, network issues, etc.)
      audio.addEventListener('error', () => {
        // Audio file may not exist - that's ok, just skip audio
        // Don't log as error - this is expected if file doesn't exist
        audio = null
      })
      
      audio.addEventListener('canplaythrough', () => {
        audioLoaded = true
      })
      
      // Try to play - will fail if no user interaction yet (modern browser requirement)
      audio.play().catch((error) => {
        // NotSupportedError/NotAllowedError are expected when autoplay is blocked
        // Only log unexpected errors
        if (error.name !== 'NotSupportedError' && error.name !== 'NotAllowedError') {
          console.warn('Audio playback error:', error)
        }
      })
    } catch (error) {
      // Audio not available - that's ok, continue without sound
      // Don't log as error - audio is optional
      audio = null
    }
    
    // Set up to play on first user interaction if it failed initially
    const playOnInteraction = () => {
      if (audio && audioLoaded && audio.paused) {
        audio.play().catch((error) => {
          // Only log non-autoplay-policy errors
          if (error.name !== 'NotSupportedError' && error.name !== 'NotAllowedError') {
            console.warn('Audio playback error on interaction:', error)
          }
        })
      }
    }
    // Using { once: true } automatically removes listeners after first event
    if (audio) {
      document.addEventListener('click', playOnInteraction, { once: true })
      document.addEventListener('touchstart', playOnInteraction, { once: true })
    }

    // Custom vibration pattern: long-short-short-short
    let vibrationInterval: NodeJS.Timeout | null = null
    if ('vibrate' in navigator) {
      const vibratePattern = [200, 100, 100, 100]
      vibrationInterval = setInterval(() => {
        navigator.vibrate(vibratePattern)
      }, 500)
    }
    
    return () => {
      // Cleanup audio
      if (audio) {
        audio.pause()
        audio.src = '' // Release audio resource
        audio = null
      }
      
      // Cleanup event listeners
      document.removeEventListener('click', playOnInteraction)
      document.removeEventListener('touchstart', playOnInteraction)
      
      // Cleanup vibration
      if (vibrationInterval) {
        clearInterval(vibrationInterval)
      }
      
      // Stop location tracking
      stopTracking()
      setLocationTrackingActive(false)
      unsubscribeReceiverLocations()
    }
  }, [alert, user, address, permissionStatus])

  const loadAlert = async () => {
    if (!user) {
      setLoading(false)
      return
    }

    try {
      const activeAlert = await getActiveEmergency(user.id)
      if (activeAlert && activeAlert.id === alertId) {
        setAlert(activeAlert)
        if (activeAlert.location_lat && activeAlert.location_lng) {
          setLocation({
            lat: activeAlert.location_lat,
            lng: activeAlert.location_lng,
          })
          if (activeAlert.address) {
            setAddress(activeAlert.address)
          }
        }
      } else {
        // Alert doesn't exist or doesn't belong to user
        console.warn('Alert not found or access denied')
        router.push('/dashboard')
      }
    } catch (error: any) {
      console.error('Failed to load alert:', error)
      // Redirect to dashboard on error
      router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!user || !alert) return

    const confirmed = window.confirm(
      'Are you sure you want to cancel this emergency alert?'
    )

    if (!confirmed) return

    try {
      const { cancelEmergencyAlert } = await import('@/lib/services/emergency')
      await cancelEmergencyAlert(alert.id)
      
      // Successfully cancelled - redirect to dashboard
      // Add a small delay to ensure cancellation is processed before redirect
      setTimeout(() => {
        router.push('/dashboard')
      }, 300)
    } catch (error: any) {
      console.error('Cancel alert error:', error)
      const errorMessage = error?.message || 'Failed to cancel alert. Please try again.'
      
      // Check if it's an RLS policy error - don't redirect in this case
      // The migration should fix this, but if it hasn't been run, show helpful message
      if (errorMessage.includes('database policy') || 
          errorMessage.includes('RLS policy') ||
          errorMessage.includes('migrations/fix-all-rls-policies-comprehensive.sql')) {
        // RLS error - show error and stay on page (don't redirect to prevent loop)
        window.alert(
          '⚠️ Database Policy Error\n\n' +
          'Unable to cancel alert. This usually means the migration hasn\'t been run yet.\n\n' +
          'Please run migrations/fix-all-rls-policies-comprehensive.sql in Supabase SQL Editor.\n\n' +
          'After running the migration, cancellation will work properly.'
        )
        return // Don't redirect - stay on page to prevent redirect loop
      }
      
      // Check if the error suggests the alert might already be cancelled
      if (errorMessage.includes('already been cancelled') || 
          errorMessage.includes('may have already been cancelled')) {
        // Alert might be cancelled - redirect to dashboard
        setTimeout(() => {
          router.push('/dashboard')
        }, 300)
      } else {
        // Other errors - show error and stay on page
        window.alert(errorMessage)
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-sa-red flex items-center justify-center">
        <div className="text-center text-white">
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (!alert) {
    return (
      <div className="min-h-screen bg-sa-red flex items-center justify-center">
        <div className="text-center text-white">
          <p>Emergency alert not found</p>
          <Button
            variant="secondary"
            onClick={() => router.push('/dashboard')}
            className="mt-4"
          >
            Return to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-sa-red p-4 text-white">
      <div className="max-w-4xl mx-auto">
        {/* Alert Banner */}
        <Card className="mb-6 border-4 border-white bg-sa-red text-white">
          <div className="text-center">
            {/* Alert Icon */}
            <div className="mb-4">
              <AlertTriangle className="w-16 h-16 mx-auto text-white" />
            </div>

            {/* Alert Message */}
            <h1 className="text-3xl font-bold mb-2">EMERGENCY ALERT</h1>
            <p className="text-xl mb-1">Your alert has been sent</p>
            <p className="text-lg opacity-90 mb-4">
              Your contacts are being notified with your location
            </p>

            {/* Alert Type */}
            <div className="bg-white/20 rounded-lg p-3 inline-block">
              <p className="text-sm opacity-75">Alert Type</p>
              <p className="text-lg font-semibold capitalize">{alert.alert_type.replace('_', ' ')}</p>
            </div>
          </div>
        </Card>

        {/* Location Permission Prompt */}
        {showPermissionPrompt && (
          <LocationPermissionPrompt
            onPermissionGranted={() => {
              setShowPermissionPrompt(false)
              // Permission granted, location tracking will start automatically
            }}
            onDismiss={() => setShowPermissionPrompt(false)}
          />
        )}

        {/* Location Info */}
        {location && (
          <Card className="mb-6 bg-white/10 backdrop-blur-sm border-white/20">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-5 h-5 text-white" />
              <span className="font-medium text-white">Your Location</span>
            </div>
            {address && (
              <p className="text-sm text-white opacity-90 mb-2">{address}</p>
            )}
            <p className="text-xs text-white opacity-75">
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
            </p>
          </Card>
        )}

        {/* Location Map */}
        {location && alert && user && (
          <Card className="mb-6 bg-white border-white/20">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-5 h-5 text-sa-red" />
              <h2 className="text-xl font-bold text-gray-900">Your Location on Map</h2>
            </div>
            <div className="w-full h-96 rounded-lg overflow-hidden bg-gray-200">
              <GoogleMapComponent
                latitude={location.lat}
                longitude={location.lng}
                alertId={alert.id}
                user_id={alert.user_id}
                receiverLocations={receiverLocations}
                receiverUserIds={receiverUserIds}
                senderUserId={user.id}
              />
            </div>
            
            {/* Location Tracking Status */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {locationTrackingActive ? (
                    <>
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="text-gray-700">Live tracking active</span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                      <span className="text-gray-500">Tracking paused</span>
                    </>
                  )}
                </div>
                {lastLocationUpdate && (
                  <span className="text-gray-500">
                    Updated {Math.floor((Date.now() - lastLocationUpdate.getTime()) / 1000)}s ago
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Your location updates automatically every 10 seconds. Contacts can track your movement in real-time.
              </p>
            </div>
          </Card>
        )}

        {/* Actions */}
        <Card className="mb-6 bg-white/10 backdrop-blur-sm border-white/20">
          <div className="space-y-4">
            {/* Cancel Button */}
            <Button
              variant="secondary"
              size="lg"
              onClick={handleCancel}
              className="w-full flex items-center justify-center gap-2"
            >
              <X className="w-5 h-5" />
              Cancel Alert
            </Button>

            {/* Help Text */}
            <p className="text-xs text-white opacity-75 text-center">
              Keep this screen open so your location updates in real-time
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}

