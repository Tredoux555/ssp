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
  const [acceptedResponderCount, setAcceptedResponderCount] = useState(0)
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

    // Query all receiver locations from location_history (only from accepted responders)
    const loadReceiverLocations = async () => {
      try {
        const supabase = createClient()
        if (!supabase) {
          console.error('[Sender] Supabase client not available')
          return
        }

        // First, get all accepted responders for this alert
        const { data: acceptedResponses, error: responsesError } = await supabase
          .from('alert_responses')
          .select('contact_user_id')
          .eq('alert_id', alert.id)
          .not('acknowledged_at', 'is', null)

        if (responsesError) {
          // Check if it's an RLS error
          if (responsesError.code === '42501' || responsesError.message?.includes('row-level security') || responsesError.message?.includes('RLS')) {
            console.error('[Sender] ❌ RLS policy blocking alert_responses query:', {
              error: responsesError,
              code: responsesError.code,
              message: responsesError.message,
              hint: responsesError.hint,
              alertId: alert.id,
              userId: user.id,
              note: 'Migration fix-alert-responses-sender-view.sql may need to be run in Supabase'
            })
          } else {
            console.error('[Sender] Failed to load accepted responses:', {
              error: responsesError,
              code: responsesError.code,
              message: responsesError.message,
              alertId: alert.id,
              userId: user.id
            })
          }
          return
        }

        // Update accepted responder count
        setAcceptedResponderCount(acceptedResponses?.length || 0)

        // If no accepted responders, clear the map
        if (!acceptedResponses || acceptedResponses.length === 0) {
          console.log('[Sender] No accepted responders yet')
          setReceiverLocations(new Map())
          setReceiverUserIds([])
          return
        }

        const acceptedUserIds = acceptedResponses.map((r: { contact_user_id: string }) => r.contact_user_id)
        console.log('[Sender] Querying locations for accepted responders:', acceptedUserIds)

        // Get all locations for this alert where user_id != sender.user_id AND user has accepted
        // Add retry logic for RLS errors
        let allLocations: LocationHistory[] | null = null
        let error: any = null
        let retries = 2
        let delay = 500
        
        while (retries >= 0) {
          const result = await supabase
            .from('location_history')
            .select('*')
            .eq('alert_id', alert.id)
            .neq('user_id', user.id)
            .in('user_id', acceptedUserIds)
            .order('created_at', { ascending: false })
            .limit(50)
          
          if (result.error) {
            error = result.error
            // Check if it's an RLS error and we have retries left
            if ((error.code === '42501' || error.message?.includes('row-level security') || error.message?.includes('RLS')) && retries > 0) {
              console.warn(`[Sender] RLS error, retrying in ${delay}ms (${retries} retries left):`, {
                code: error.code,
                message: error.message
              })
              await new Promise(resolve => setTimeout(resolve, delay))
              delay *= 2
              retries--
              continue
            }
            break
          } else {
            allLocations = result.data
            error = null
            break
          }
        }

        if (error) {
          // Check if it's an RLS error
          if (error.code === '42501' || error.message?.includes('row-level security') || error.message?.includes('RLS')) {
            console.error('[Sender] RLS policy blocked receiver location query after retries:', {
              code: error.code,
              message: error.message,
              hint: error.hint,
              alertId: alert.id,
              userId: user.id,
              acceptedUserIds: acceptedUserIds,
              note: 'RLS migration may need to be run in Supabase'
            })
          } else {
            console.error('[Sender] Failed to load receiver locations:', {
              error: error,
              code: error.code,
              message: error.message,
              details: error.details,
              hint: error.hint,
              alertId: alert.id,
              userId: user.id,
              acceptedUserIds: acceptedUserIds
            })
          }
          // Don't return - try to continue with empty locations
          setReceiverLocations(new Map())
          setReceiverUserIds([])
          return
        }

        if (allLocations && allLocations.length > 0) {
          console.log('[Sender] ✅ Loaded receiver locations:', {
            count: allLocations.length,
            uniqueReceivers: new Set(allLocations.map(loc => loc.user_id)).size,
            locations: allLocations.map(loc => ({
              userId: loc.user_id,
              lat: loc.latitude,
              lng: loc.longitude,
              timestamp: loc.created_at
            }))
          })
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

          console.log('[Sender] ✅ Grouped receiver locations:', {
            receiverCount: userIds.size,
            receiverIds: Array.from(userIds),
            locationsPerReceiver: Array.from(receiverMap.entries()).map(([id, locs]) => ({
              receiverId: id,
              locationCount: locs.length
            }))
          })

          setReceiverLocations(receiverMap)
          setReceiverUserIds(Array.from(userIds))
        } else {
          console.log('[Sender] ⚠️ No receiver locations found for accepted responders:', {
            acceptedUserIds: acceptedUserIds,
            alertId: alert.id
          })
          setReceiverLocations(new Map())
          setReceiverUserIds([])
        }
      } catch (error: any) {
        console.error('[Sender] Error loading receiver locations:', {
          error: error,
          message: error?.message,
          stack: error?.stack,
          alertId: alert.id,
          userId: user.id
        })
        setReceiverLocations(new Map())
        setReceiverUserIds([])
      }
    }

    loadReceiverLocations()

    // Subscribe to alert_responses updates to detect when responders accept
    const unsubscribeAcceptance = createClient()
      ?.channel(`alert-responses-${alert.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'alert_responses',
          filter: `alert_id=eq.${alert.id}`,
        },
        (payload: any) => {
          console.log('[Sender] ✅ Alert response update received:', {
            contactUserId: payload.new.contact_user_id,
            acknowledgedAt: payload.new.acknowledged_at,
            alertId: alert.id,
            oldAcknowledgedAt: payload.old?.acknowledged_at
          })
          // When someone accepts, reload receiver locations and update count
          if (payload.new.acknowledged_at) {
            console.log('[Sender] ✅ Responder accepted - reloading locations:', {
              contactUserId: payload.new.contact_user_id,
              alertId: alert.id
            })
            // Update count immediately
            setAcceptedResponderCount((prev) => prev + 1)
            // Reload receiver locations
            loadReceiverLocations()
          }
        }
      )
      .subscribe((status: any) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Sender] ✅ Successfully subscribed to alert_responses updates')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Sender] ❌ Failed to subscribe to alert_responses updates - will use polling fallback')
        } else {
          console.log('[Sender] Alert responses subscription status:', status)
        }
      })
    
    // Add polling fallback to check for accepted responders (in case subscription fails)
    // Poll every 5 seconds to check if anyone has accepted
    const acceptancePollInterval = setInterval(async () => {
      if (!alert || !user) return
      
      try {
        const supabase = createClient()
        const { data: acceptedResponses, error: pollError } = await supabase
          .from('alert_responses')
          .select('contact_user_id')
          .eq('alert_id', alert.id)
          .not('acknowledged_at', 'is', null)
        
        if (pollError) {
          // Check if it's an RLS error
          if (pollError.code === '42501' || pollError.message?.includes('row-level security')) {
            console.error('[Sender] ⚠️ RLS policy blocking alert_responses query in polling:', {
              code: pollError.code,
              message: pollError.message,
              hint: pollError.hint,
              note: 'Migration fix-alert-responses-sender-view.sql may need to be run in Supabase'
            })
          }
          return
        }
        
        const currentCount = acceptedResponses?.length || 0
        if (currentCount !== acceptedResponderCount) {
          console.log('[Sender] ✅ Polling detected acceptance change:', {
            oldCount: acceptedResponderCount,
            newCount: currentCount,
            alertId: alert.id
          })
          setAcceptedResponderCount(currentCount)
          loadReceiverLocations()
        }
      } catch (pollErr) {
        console.warn('[Sender] Polling error (non-critical):', pollErr)
      }
    }, 5000) // Poll every 5 seconds

    // Subscribe to receiver location updates (only from accepted responders)
    const unsubscribeReceiverLocations = subscribeToLocationHistory(alert.id, async (newLocation) => {
      console.log('[Sender] Location update received:', {
        userId: newLocation.user_id,
        senderUserId: user.id,
        isSender: newLocation.user_id === user.id
      })
      
      // Only process receiver locations (not sender's own location)
      if (newLocation.user_id !== user.id) {
        // Check if this user has accepted to respond
        const supabase = createClient()
        if (supabase) {
          const { data: response, error: responseError } = await supabase
            .from('alert_responses')
            .select('acknowledged_at')
            .eq('alert_id', alert.id)
            .eq('contact_user_id', newLocation.user_id)
            .maybeSingle()
          
          if (responseError) {
            console.error('[Sender] Error checking acceptance status:', {
              error: responseError,
              receiverUserId: newLocation.user_id,
              alertId: alert.id
            })
          }
          
          // Only add location if user has accepted
          if (response && response.acknowledged_at) {
            console.log('[Sender] ✅ Adding accepted responder location:', {
              receiverId: newLocation.user_id,
              location: { lat: newLocation.latitude, lng: newLocation.longitude },
              timestamp: newLocation.created_at
            })
            setReceiverLocations((prev) => {
              const updated = new Map(prev)
              const receiverId = newLocation.user_id
              
              if (!updated.has(receiverId)) {
                updated.set(receiverId, [])
                setReceiverUserIds((prevIds) => {
                  if (!prevIds.includes(receiverId)) {
                    console.log('[Sender] ✅ Added new receiver to map:', receiverId)
                    return [...prevIds, receiverId]
                  }
                  return prevIds
                })
              }
              
              updated.get(receiverId)!.push(newLocation)
              console.log('[Sender] ✅ Updated receiver locations map:', {
                receiverId,
                totalLocations: updated.get(receiverId)!.length
              })
              return updated
            })
          } else {
            console.log('[Sender] ⚠️ Ignoring location from non-accepted responder:', {
              receiverId: newLocation.user_id,
              hasResponse: !!response,
              acknowledgedAt: response?.acknowledged_at
            })
          }
        }
      } else {
        console.log('[Sender] Ignoring own location update')
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
      // Cleanup subscriptions
      unsubscribeReceiverLocations()
      unsubscribeAcceptance?.unsubscribe()
      
      // Cleanup polling intervals
      if (acceptancePollInterval) {
        clearInterval(acceptancePollInterval)
      }
      
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
      
      console.log('[Sender] ✅ Alert cancelled successfully - redirecting to dashboard')
      
      // Successfully cancelled - redirect to dashboard immediately
      // Use replace instead of push to prevent back navigation to cancelled alert
      router.replace('/dashboard')
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
            {acceptedResponderCount > 0 && (
              <p className="text-green-600 font-medium">
                {acceptedResponderCount} responder{acceptedResponderCount !== 1 ? 's' : ''} accepted
              </p>
            )}
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

