'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { getActiveEmergency } from '@/lib/emergency'
import { startLocationTracking, getCurrentLocation, reverseGeocode } from '@/lib/location'
import { createClient } from '@/lib/supabase'
import { subscribeToLocationHistory } from '@/lib/realtime/subscriptions'
import { EmergencyAlert, LocationHistory } from '@/types/database'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { AlertTriangle, X, MapPin, Camera } from 'lucide-react'
import dynamic from 'next/dynamic'
import LocationPermissionPrompt from '@/components/LocationPermissionPrompt'
import { useLocationPermission } from '@/lib/hooks/useLocationPermission'
import { capturePhoto, uploadEmergencyPhoto, getAlertPhotos, getPhotoUrl } from '@/lib/services/photo'
import { EmergencyPhoto } from '@/types/database'

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
  const [photos, setPhotos] = useState<EmergencyPhoto[]>([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  
  // Refs to track upload state and queue location reloads
  const uploadingPhotoRef = useRef(false)
  const loadLocationsQueuedRef = useRef(false)
  const loadReceiverLocationsRef = useRef<(() => void) | null>(null)
  const loadingAlertRef = useRef(false) // Prevent concurrent loadAlert calls
  const addressRef = useRef<string>('') // Track address without causing re-renders
  const isUnmountingRef = useRef(false) // Prevent state updates during unmount/cancel

  // Update addressRef when address changes (doesn't trigger loadAlert)
  useEffect(() => {
    addressRef.current = address
  }, [address])

  const loadAlert = useCallback(async () => {
    if (!user || loadingAlertRef.current) {
      if (!user) setLoading(false)
      return
    }
    
    loadingAlertRef.current = true
    setLoading(true)

    try {
      const activeAlert = await getActiveEmergency(user.id)
      if (activeAlert && activeAlert.id === alertId) {
        setAlert(activeAlert)
        if (activeAlert.location_lat && activeAlert.location_lng) {
          setLocation({
            lat: activeAlert.location_lat,
            lng: activeAlert.location_lng,
          })
          // Only set address if it's different to prevent infinite loops
          // Use ref to check without causing dependency changes
          if (activeAlert.address && activeAlert.address !== addressRef.current) {
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
      loadingAlertRef.current = false
    }
  }, [user, alertId, router]) // REMOVED 'address' - using ref instead

  useEffect(() => {
    if (!user) return
    loadAlert()
  }, [user, alertId, loadAlert])

  useEffect(() => {
    if (!alert || !user) return

    // Check location permission before starting tracking
    if (permissionStatus === 'denied' || permissionStatus === 'prompt') {
      setShowPermissionPrompt(true)
    } else if (permissionStatus === 'granted') {
      setShowPermissionPrompt(false)
    }

    // Query all receiver locations from location_history (only from accepted responders)
    // Uses server-side API endpoints to bypass RLS
    const loadReceiverLocations = async () => {
      // Guard check - ensure alert exists before making API calls
      if (!alert || !alert.id) {
        console.warn('[Sender] Cannot load receiver locations - alert not available', {
          hasAlert: !!alert,
          alertId: alert?.id
        })
        return
      }
      
      // Don't reload locations if photo upload is in progress
      if (uploadingPhotoRef.current) {
        console.log('[Photo] ⏸️ Deferring location reload - photo upload in progress')
        loadLocationsQueuedRef.current = true
        return
      }
      
      try {
        // Use API endpoint to get accepted responders (bypasses RLS)
        // Use no-store to prevent caching - we need real-time data
        const acceptedResponse = await fetch(`/api/emergency/${alert.id}/accepted-responders`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache'
          }
        })
        
        // Handle 304 as success (cached response is still valid, but we're preventing caching anyway)
        if (!acceptedResponse.ok && acceptedResponse.status !== 304) {
          // Always log the status code, even if parsing fails
          const status = acceptedResponse.status
          const statusText = acceptedResponse.statusText
          
          let errorData: any = {}
          let responseText = ''
          
          try {
            responseText = await acceptedResponse.text()
            if (responseText && responseText.trim()) {
              errorData = JSON.parse(responseText)
            }
          } catch (parseError) {
            console.warn('[Sender] Failed to parse error response:', parseError, 'Raw text:', responseText.substring(0, 100))
          }
          
          console.error('[Sender] ❌ API endpoint failed:', {
            url: `/api/emergency/${alert?.id}/accepted-responders`,
            status: status,
            statusText: statusText,
            error: errorData.error || `HTTP ${status} ${statusText}`,
            details: errorData.details || `Server returned ${status} ${statusText}`,
            rawResponse: responseText || '(empty response)',
            alertId: alert?.id,
            hasAlert: !!alert,
            headers: {
              contentType: acceptedResponse.headers.get('content-type'),
            }
          })
          
          // Show user-friendly error if it's a known issue
          if (status === 401) {
            console.error('[Sender] ⚠️ Authentication error - user may need to log in again')
          } else if (status === 404) {
            console.error('[Sender] ⚠️ Alert not found - it may have been deleted or the alert ID is invalid')
            console.error('[Sender] ⚠️ Alert details:', {
              alertId: alert?.id,
              alertExists: !!alert,
              alertStatus: alert?.status
            })
          } else if (status === 500) {
            console.error('[Sender] ⚠️ Server error - check API logs in Vercel')
          }
          
          setReceiverLocations(new Map())
          setReceiverUserIds([])
          return
        }

        const acceptedData = await acceptedResponse.json()
        const acceptedResponses = acceptedData.acceptedResponders || []
        const acceptedCount = acceptedData.count || 0

        // Update accepted responder count
        setAcceptedResponderCount(acceptedCount)

        // If no accepted responders, clear the map
        if (acceptedCount === 0) {
          // Only log in development to reduce noise in production
          if (process.env.NODE_ENV === 'development') {
            console.log('[Sender] No accepted responders yet')
          }
          setReceiverLocations(new Map())
          setReceiverUserIds([])
          return
        }

        const acceptedUserIds = acceptedResponses.map((r: { contact_user_id: string }) => r.contact_user_id)
        console.log('[Sender] ✅ Found accepted responders via API:', {
          count: acceptedCount,
          userIds: acceptedUserIds
        })

        // Use API endpoint to get receiver locations (bypasses RLS)
        // Use no-store to prevent caching - we need real-time data
        const locationsResponse = await fetch(`/api/emergency/${alert.id}/receiver-locations`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache'
          }
        })
        
        // Handle 304 as success (cached response is still valid, but we're preventing caching anyway)
        if (!locationsResponse.ok && locationsResponse.status !== 304) {
          const errorData = await locationsResponse.json().catch(() => ({}))
          console.error('[Sender] Failed to fetch receiver locations:', {
            status: locationsResponse.status,
            error: errorData.error || 'Unknown error',
            alertId: alert.id
          })
          // Don't clear - keep accepted count, just no locations yet
          setReceiverLocations(new Map())
          setReceiverUserIds([])
          return
        }

        const locationsData = await locationsResponse.json()
        const groupedByUser = locationsData.groupedByUser || {}
        const allLocations = locationsData.receiverLocations || []

        if (allLocations && allLocations.length > 0) {
          console.log('[Sender] ✅ Loaded receiver locations via API:', {
            count: allLocations.length,
            uniqueReceivers: Object.keys(groupedByUser).length,
            receiverIds: Object.keys(groupedByUser),
            locationsPerReceiver: Object.entries(groupedByUser).map(([id, locs]: [string, any]) => ({
              receiverId: id,
              locationCount: locs.length
            }))
          })
          
          // Convert groupedByUser object to Map
          const receiverMap = new Map<string, LocationHistory[]>()
          const userIds = new Set<string>()

          Object.entries(groupedByUser).forEach(([receiverId, locations]: [string, any]) => {
            userIds.add(receiverId)
            receiverMap.set(receiverId, locations as LocationHistory[])
          })

          setReceiverLocations(receiverMap)
          setReceiverUserIds(Array.from(userIds))
        } else {
          console.log('[Sender] ⚠️ No receiver locations found yet (accepted responders exist but no locations saved):', {
            acceptedUserIds: acceptedUserIds,
            alertId: alert.id
          })
          // Keep accepted count but clear locations
          setReceiverLocations(new Map())
          setReceiverUserIds([])
        }
      } catch (error: any) {
        console.error('[Sender] Error loading receiver locations via API:', {
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
    
    // Store function in ref for safe access
    loadReceiverLocationsRef.current = loadReceiverLocations
    
    // Safe wrapper that checks upload state before calling
    // NOTE: Cannot use useCallback here - it's inside useEffect (violates Rules of Hooks)
    // Just use a regular function instead
    const safeLoadReceiverLocations = () => {
      if (uploadingPhotoRef.current) {
        console.log('[Photo] ⏸️ Deferring location reload - photo upload in progress')
        loadLocationsQueuedRef.current = true
        return
      }
      if (loadReceiverLocationsRef.current) {
        loadReceiverLocationsRef.current()
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
          if (isUnmountingRef.current) return // Don't update state if unmounting
          
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
            // Reload receiver locations (safely - won't interrupt uploads)
            safeLoadReceiverLocations()
          }
        }
      )
      .subscribe((status: any, err?: any) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Sender] ✅ Successfully subscribed to alert_responses updates')
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
          // Network or other error - log in development only
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Sender] ⚠️ Subscription error:', {
              status,
              error: err,
              note: 'Using polling fallback'
            })
          }
          // Immediately trigger polling fallback when subscription fails
          safeLoadReceiverLocations()
        } else {
          // Only log non-critical statuses in development
          if (process.env.NODE_ENV === 'development') {
            console.log('[Sender] Alert responses subscription status:', status)
          }
          // If subscription closes for any reason, trigger polling
          if (status === 'CLOSED') {
            if (process.env.NODE_ENV === 'development') {
              console.warn('[Sender] ⚠️ Subscription closed - triggering immediate polling check')
            }
            loadReceiverLocations()
          }
        }
      })
    
    // Add polling fallback to check for accepted responders (in case subscription fails)
    // Poll every 3 seconds to check if anyone has accepted (more frequent for better responsiveness)
    // Uses API endpoint to bypass RLS
    const acceptancePollInterval = setInterval(async () => {
      if (!alert || !user || isUnmountingRef.current) return // Check unmounting flag
      
      try {
        // Use API endpoint instead of direct query (bypasses RLS)
        // Use no-store to prevent caching - we need real-time data
        const response = await fetch(`/api/emergency/${alert.id}/accepted-responders`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache'
          }
        })
        
        // Handle 304 as success (cached response is still valid, but we're preventing caching anyway)
        if (!response.ok && response.status !== 304) {
          // Silently handle errors - API might be temporarily unavailable
          if (process.env.NODE_ENV === 'development') {
            const errorData = await response.json().catch(() => ({}))
            console.warn('[Sender] ⚠️ Polling API error:', {
              status: response.status,
              error: errorData.error
            })
          }
          return
        }
        
        const data = await response.json()
        const currentCount = data.count || 0
        
        if (currentCount !== acceptedResponderCount) {
          if (isUnmountingRef.current) return // Don't update if unmounting
          
          console.log('[Sender] ✅ Polling detected acceptance change via API:', {
            oldCount: acceptedResponderCount,
            newCount: currentCount,
            acceptedUserIds: data.acceptedResponders?.map((r: { contact_user_id: string }) => r.contact_user_id),
            alertId: alert.id
          })
          setAcceptedResponderCount(currentCount)
          // Immediately reload receiver locations when acceptance is detected (safely)
          safeLoadReceiverLocations()
        } else if (currentCount > 0) {
          if (isUnmountingRef.current) return // Don't update if unmounting
          
          // Even if count hasn't changed, periodically reload locations to get latest updates
          // This ensures we get location updates even if subscription is working
          console.log('[Sender] 🔄 Periodic location refresh via API (polling fallback):', {
            acceptedCount: currentCount,
            alertId: alert.id
          })
          safeLoadReceiverLocations()
        }
      } catch (pollErr) {
        // Silently handle polling errors - non-critical
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Sender] Polling error (non-critical):', pollErr)
        }
      }
    }, 3000) // Poll every 3 seconds for better responsiveness

    // Subscribe to receiver location updates (only from accepted responders)
    const unsubscribeReceiverLocations = subscribeToLocationHistory(alert.id, async (newLocation) => {
      if (isUnmountingRef.current) return // Don't update state if unmounting
      
      console.log('[Sender] Location update received:', {
        userId: newLocation.user_id,
        senderUserId: user.id,
        isSender: newLocation.user_id === user.id
      })
      
      // Only process receiver locations (not sender's own location)
      if (newLocation.user_id !== user.id) {
        // Use API to check if this user has accepted to respond (bypasses RLS)
        try {
          // Use no-store to prevent caching - we need real-time data
          const acceptanceResponse = await fetch(`/api/emergency/${alert.id}/accepted-responders`, {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache'
            }
          })
          
          // Handle 304 as success (cached response is still valid, but we're preventing caching anyway)
          if (acceptanceResponse.ok || acceptanceResponse.status === 304) {
            // 304 responses have no body, so we need to handle it differently
            let acceptanceData: any
            if (acceptanceResponse.status === 304) {
              // For 304, we'll reload all locations to get fresh data (safely)
              safeLoadReceiverLocations()
              return
            } else {
              acceptanceData = await acceptanceResponse.json()
            }
            const acceptedUserIds = acceptanceData.acceptedResponders?.map((r: { contact_user_id: string }) => r.contact_user_id) || []
            const hasAccepted = acceptedUserIds.includes(newLocation.user_id)
            
            if (hasAccepted) {
              console.log('[Sender] ✅ Adding accepted responder location from subscription:', {
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
                
                // Add new location to receiver's history
                const receiverHistory = updated.get(receiverId) || []
                // Check if this location already exists (avoid duplicates)
                const exists = receiverHistory.some(loc => loc.id === newLocation.id)
                if (!exists) {
                  updated.set(receiverId, [...receiverHistory, newLocation])
                }
                
                return updated
              })
            } else {
              // User hasn't accepted yet - ignore this location update
              if (process.env.NODE_ENV === 'development') {
                console.log('[Sender] ⏭️ Ignoring location update from non-accepted user:', newLocation.user_id)
              }
            }
          } else {
            // API call failed - fallback: reload all locations
            if (process.env.NODE_ENV === 'development') {
              console.warn('[Sender] ⚠️ Failed to check acceptance via API, reloading all locations')
            }
            safeLoadReceiverLocations()
          }
        } catch (apiError) {
          // API call failed - fallback: reload all locations
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Sender] ⚠️ Error checking acceptance via API:', apiError)
          }
          safeLoadReceiverLocations()
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
        if (isUnmountingRef.current) return // Don't update state if unmounting
        
        setLocation(loc)
        setLastLocationUpdate(new Date())
        setLocationTrackingActive(true)
        // Only set address if it's not already set to prevent infinite loops
        if (!address && loc) {
          try {
            const addr = await reverseGeocode(loc.lat, loc.lng)
            if (addr && addr !== address) setAddress(addr)
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
            // Only set address if it's different to prevent infinite loops
            if (addr && addr !== address) setAddress(addr)
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
            // Only set address if it's different to prevent infinite loops
            if (alert.address && alert.address !== address) {
              setAddress(alert.address)
            } else if (!address) {
              try {
                const addr = await reverseGeocode(alert.location_lat, alert.location_lng)
                if (addr && addr !== address) setAddress(addr)
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
          // Only set address if it's different to prevent infinite loops
          if (alert.address && alert.address !== address) {
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
      // Set unmounting flag IMMEDIATELY to prevent any state updates
      isUnmountingRef.current = true
      
      // Cleanup subscriptions FIRST (before any state updates)
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
      
      // Stop location tracking (NO STATE UPDATES IN CLEANUP!)
      if (stopTracking) {
        stopTracking()
      }
      // REMOVED: setLocationTrackingActive(false) - this causes React error #321
    }
  }, [alert, user, permissionStatus]) // Removed 'address' from dependencies to prevent infinite loop

  // Load photos and subscribe to photo updates
  useEffect(() => {
    if (!alert || !user) return

    // Load existing photos
    const loadPhotos = async () => {
      if (alert.id && !isUnmountingRef.current) {
        const alertPhotos = await getAlertPhotos(alert.id)
        if (!isUnmountingRef.current) {
          setPhotos(alertPhotos)
        }
      }
    }
    loadPhotos()

    // Subscribe to new photos
    const supabase = createClient()
    const photoSubscription = supabase
      .channel(`emergency-photos-${alert.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emergency_photos',
          filter: `alert_id=eq.${alert.id}`,
        },
        (payload: { new: EmergencyPhoto }) => {
          if (isUnmountingRef.current) return // Don't update state if unmounting
          
          console.log('[Photo] ✅ New photo received:', payload.new)
          setPhotos((prev) => [payload.new as EmergencyPhoto, ...prev])
        }
      )
      .subscribe()

    return () => {
      isUnmountingRef.current = true // Set flag before cleanup
      photoSubscription.unsubscribe()
    }
  }, [alert, user])

  const handleCancel = async () => {
    if (!user || !alert || isUnmountingRef.current) return

    const confirmed = window.confirm(
      'Are you sure you want to cancel this emergency alert?'
    )

    if (!confirmed) return

    // Set unmounting flag IMMEDIATELY to prevent any state updates
    isUnmountingRef.current = true

    try {
      const { cancelEmergencyAlert } = await import('@/lib/services/emergency')
      await cancelEmergencyAlert(alert.id)
      
      console.log('[Sender] ✅ Alert cancelled successfully - redirecting to dashboard')
      
      // Successfully cancelled - redirect to dashboard immediately
      // Use window.location.href to completely unload component and prevent React error #321
      // This ensures no state updates happen during navigation
      window.location.href = '/dashboard'
    } catch (error: any) {
      // Reset unmounting flag on error so user can try again
      isUnmountingRef.current = false
      
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
        // Alert might be cancelled - redirect to dashboard using window.location
        // This prevents React error #321 by completely unloading the component
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 300)
      } else {
        // Other errors - show error and stay on page
        window.alert(errorMessage)
      }
    }
  }

  const handleCapturePhoto = async () => {
    if (!alert || !user || uploadingPhoto || uploadingPhotoRef.current) return

    try {
      console.log('[Photo] 📸 Button clicked - starting capture')
      uploadingPhotoRef.current = true
      setUploadingPhoto(true)
      
      const file = await capturePhoto()
      console.log('[Photo] 📁 File captured:', file ? { name: file.name, size: file.size, type: file.type } : 'null')
      
      if (!file) {
        console.log('[Photo] ⚠️ No file selected')
        uploadingPhotoRef.current = false
        setUploadingPhoto(false)
        return
      }

      console.log('[Photo] 🚀 Starting upload process...')
      const photo = await uploadEmergencyPhoto(alert.id, user.id, file)
      
      if (photo) {
        console.log('[Photo] ✅ Photo uploaded successfully:', photo.id)
        // Photo will be added via Realtime subscription
      } else {
        console.error('[Photo] ❌ Upload returned null')
        // Error message already shown by uploadEmergencyPhoto
      }
    } catch (error: any) {
      console.error('[Photo] ❌ Error capturing photo:', {
        error: error?.message || error,
        stack: error?.stack
      })
      window.alert(`Failed to capture photo: ${error?.message || 'Unknown error'}. Please try again.`)
    } finally {
      uploadingPhotoRef.current = false
      setUploadingPhoto(false)
      
      // Reload locations if queued during upload
      if (loadLocationsQueuedRef.current) {
        console.log('[Photo] ✅ Upload complete - reloading queued locations')
        loadLocationsQueuedRef.current = false
        if (loadReceiverLocationsRef.current) {
          loadReceiverLocationsRef.current()
        }
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
            {/* Capture Photo Button */}
            <Button
              variant="primary"
              size="lg"
              onClick={handleCapturePhoto}
              disabled={uploadingPhoto}
              className="w-full flex items-center justify-center gap-2"
            >
              <Camera className="w-5 h-5" />
              {uploadingPhoto ? 'Uploading Photo...' : 'Take Photo'}
            </Button>

            {/* Photo Gallery */}
            {photos.length > 0 && (
              <div className="mt-4">
                <h3 className="text-white font-medium mb-2">Photos ({photos.length})</h3>
                <div className="grid grid-cols-2 gap-2">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border-2 border-white/20"
                    >
                      <img
                        src={getPhotoUrl(photo.storage_path)}
                        alt={`Emergency photo ${new Date(photo.created_at).toLocaleTimeString()}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 text-center">
                        {new Date(photo.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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

