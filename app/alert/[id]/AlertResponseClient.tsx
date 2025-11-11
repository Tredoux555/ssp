'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { createClient } from '@/lib/supabase'
import { subscribeToLocationHistory } from '@/lib/realtime/subscriptions'
import { showEmergencyAlert, hideEmergencyAlert, playAlertSound, vibrateDevice } from '@/lib/notifications'
import { startLocationTracking, getCurrentLocation } from '@/lib/location'
import { EmergencyAlert, LocationHistory } from '@/types/database'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { AlertTriangle, MapPin, X, Camera } from 'lucide-react'
import dynamic from 'next/dynamic'
import LocationPermissionPrompt from '@/components/LocationPermissionPrompt'
import { useLocationPermission } from '@/lib/hooks/useLocationPermission'
import { getAlertPhotos, getPhotoUrl } from '@/lib/services/photo'
import { EmergencyPhoto } from '@/types/database'

// Dynamically import Google Maps to avoid SSR issues
const GoogleMapComponent = dynamic(
  () => import('@/components/EmergencyMap'),
  { ssr: false }
)

export default function AlertResponsePage() {
  const params = useParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const alertId = params.id as string
  const [alert, setAlert] = useState<EmergencyAlert | null>(null)
  const [location, setLocation] = useState<LocationHistory | null>(null)
  const [locationHistory, setLocationHistory] = useState<LocationHistory[]>([])
  const [receiverLocation, setReceiverLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [receiverLocationHistory, setReceiverLocationHistory] = useState<LocationHistory[]>([])
  const [receiverTrackingActive, setReceiverTrackingActive] = useState(false)
  const [receiverLastUpdate, setReceiverLastUpdate] = useState<Date | null>(null)
  const { permissionStatus, requestPermission } = useLocationPermission()
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false)
  const [loading, setLoading] = useState(true)
  const [senderName, setSenderName] = useState<string | null>(null)
  const [senderEmail, setSenderEmail] = useState<string | null>(null)
  const [hasAccepted, setHasAccepted] = useState(false)
  const [hasDeclined, setHasDeclined] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [isClosing, setIsClosing] = useState(false) // Prevent multiple close attempts
  const [photos, setPhotos] = useState<EmergencyPhoto[]>([])
  const [allReceiverLocations, setAllReceiverLocations] = useState<Map<string, LocationHistory[]>>(new Map())
  const [allReceiverUserIds, setAllReceiverUserIds] = useState<string[]>([])
  const [acceptedResponderCount, setAcceptedResponderCount] = useState(0)
  const isClosingRef = useRef(false) // Ref version for use in callbacks
  const subscriptionsSetupRef = useRef<string | null>(null) // Track which alert ID subscriptions are set up for
  const loadAlertCalledRef = useRef<string | null>(null) // Track if loadAlert has been called for this alertId
  const loadingReceiverLocationsRef = useRef(false) // Prevent concurrent API calls
  const cleanupRefs = useRef<{
    unsubscribeLocation?: () => void
    unsubscribeAlert?: () => void
    pollInterval?: NodeJS.Timeout
    statusPollInterval?: NodeJS.Timeout
    receiverLocationsPollInterval?: NodeJS.Timeout
    stopReceiverTracking?: () => void
  }>({})

  const loadAlert = useCallback(async () => {
    if (!user) return

    const supabase = createClient()

    try {
      // Get alert - contact can see if they're in the contacts_notified array
      const { data, error } = await supabase
        .from('emergency_alerts')
        .select('*')
        .eq('id', alertId)
        .single()

      if (error) {
        // Check if it's an RLS error
        if (error.code === '42501' || error.message?.includes('row-level security') || error.message?.includes('RLS')) {
          console.error('[Alert] RLS policy blocked access to alert:', {
            error: error.message,
            code: error.code,
            alertId,
            userId: user.id
          })
          router.push('/dashboard')
          return
        }
        // Check if alert not found
        if (error.code === 'PGRST116') {
          console.error('[Alert] Alert not found:', alertId)
          router.push('/dashboard')
          return
        }
        throw error
      }

      if (!data) {
        console.error('[Alert] Alert not found or access denied:', alertId)
        router.push('/dashboard')
        return
      }

      const alertData = data as EmergencyAlert

      // Check if user is a contact - normalize IDs for comparison (UUID vs TEXT)
      const normalizedUserId = String(user.id).trim()
      const normalizedContacts = alertData.contacts_notified?.map((id: string) => String(id).trim()) || []
      const isContact = normalizedContacts.includes(normalizedUserId)

      if (!isContact) {
        console.warn('[Alert] User not in contacts_notified:', {
          userId: normalizedUserId,
          contactsNotified: normalizedContacts,
          alertId: alertId,
          alertUserId: alertData.user_id
        })
        router.push('/dashboard')
        return
      }

      console.log('[Alert] ✅ User has access to alert:', {
        alertId,
        userId: normalizedUserId,
        contactsNotifiedCount: normalizedContacts.length
      })

      setAlert(alertData)

      // Initialize location from alert data immediately (for mobile compatibility)
      // This ensures map shows even if location_history query is slow or fails
      if (alertData.location_lat && alertData.location_lng) {
        setLocation({
          id: 'initial',
          alert_id: alertData.id,
          user_id: alertData.user_id,
          latitude: alertData.location_lat,
          longitude: alertData.location_lng,
          created_at: alertData.triggered_at || new Date().toISOString(),
          timestamp: alertData.triggered_at || new Date().toISOString(),
        } as LocationHistory)
      }

      // DON'T show overlay on alert page - the page itself is the alert view
      // Hide any existing overlay when viewing alert page
      hideEmergencyAlert()

      // Check if user has already accepted or declined to respond
      const { data: alertResponse, error: responseError } = await supabase
        .from('alert_responses')
        .select('acknowledged_at, declined_at')
        .eq('alert_id', alertId)
        .eq('contact_user_id', user.id)
        .maybeSingle()

      if (alertResponse) {
        if (alertResponse.acknowledged_at) {
          setHasAccepted(true)
          setHasDeclined(false)
        } else if (alertResponse.declined_at) {
          setHasDeclined(true)
          setHasAccepted(false)
        } else {
          setHasAccepted(false)
          setHasDeclined(false)
        }
      } else {
        setHasAccepted(false)
        setHasDeclined(false)
      }
      
      // Fetch sender information (with 30-second cache)
      const fetchSenderInfo = async () => {
        if (!alertData.user_id || !user) return
        
        const cacheKey = `${alertData.user_id}-${user.id}`
        const now = Date.now()
        const cached = (window as any).__senderInfoCache?.get(cacheKey)
        
        if (cached && (now - cached.timestamp) < 30000) {
          // Use cached data
          setSenderName(cached.data.name)
          setSenderEmail(cached.data.email)
          return
        }
        
        // Initialize cache if needed
        if (!(window as any).__senderInfoCache) {
          (window as any).__senderInfoCache = new Map()
        }
        
        try {
          const supabase = createClient()
          
          // Try from emergency_contacts first
          const { data: senderContact } = await supabase
            .from('emergency_contacts')
            .select('name, email')
            .eq('contact_user_id', alertData.user_id)
            .eq('user_id', user.id)
            .maybeSingle()
          
          let senderName: string | null = null
          let senderEmail: string | null = null
          
          if (senderContact) {
            senderName = senderContact.name || null
            senderEmail = senderContact.email || null
          } else {
            // Fallback to user_profiles
            const { data: senderProfile } = await supabase
              .from('user_profiles')
              .select('full_name, email')
              .eq('id', alertData.user_id)
              .maybeSingle()
            
            if (senderProfile) {
              senderName = senderProfile.full_name || null
              senderEmail = senderProfile.email || null
            }
          }
          
          // Cache the result
          ;(window as any).__senderInfoCache.set(cacheKey, {
            data: { name: senderName, email: senderEmail },
            timestamp: now,
          })
          
          setSenderName(senderName)
          setSenderEmail(senderEmail)
        } catch (err) {
          console.warn('[Alert] Could not fetch sender info:', err)
      }
      }
      
      fetchSenderInfo()

      // Play sound and vibrate (keep these for alert notification)
      playAlertSound()
      vibrateDevice()

      // Get initial location - prefer location_history over alert location
      // Query sender's location (where user_id = alert.user_id)
      // Add timeout to prevent hanging
      // Note: Location is already initialized from alert data above, so map will show immediately
      // This query is just to get the latest location from history
      try {
        const locationPromise = supabase
          .from('location_history')
          .select('*')
          .eq('alert_id', alertId)
          .eq('user_id', alertData.user_id) // Get sender's location
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        const timeoutPromise = new Promise<{ data: null; error: Error }>((_, reject) => 
          setTimeout(() => reject(new Error('Location query timeout')), 2000) // Reduced timeout
        )
        
        const result = await Promise.race([locationPromise, timeoutPromise]).catch(() => ({ data: null, error: null }))
        
        if (result && result.data) {
          console.log('[Receiver] Loaded sender location from history:', result.data)
          setLocation(result.data)
        } else if (result && (result as any).error) {
          const error = (result as any).error
          // Check if it's an RLS error
          if (error.code === '42501' || error.message?.includes('row-level security') || error.message?.includes('RLS')) {
            console.warn('[Receiver] RLS policy blocked location_history query (using alert location):', {
              code: error.code,
              message: error.message,
              hint: error.hint,
              alertId: alertId
            })
          } else {
            console.error('[Receiver] Failed to load sender location:', {
              error: error,
              code: error?.code,
              message: error?.message,
              details: error?.details,
              hint: error?.hint,
              alertId: alertId,
              senderUserId: alertData.user_id,
              receiverUserId: user.id
            })
          }
          // Fallback to alert location (already set above, but ensure it's set)
          if (alertData.location_lat && alertData.location_lng && !location) {
            console.log('[Receiver] Using fallback alert location due to query error')
        setLocation({
          id: 'initial',
          user_id: alertData.user_id,
          alert_id: alertId,
          latitude: alertData.location_lat,
          longitude: alertData.location_lng,
          timestamp: alertData.triggered_at,
          created_at: alertData.triggered_at,
            } as LocationHistory)
      }
        }
        // If no result and no error, location is already set from alert data above
      } catch (locationErr: any) {
        console.error('[Receiver] Error fetching initial location:', {
          error: locationErr,
          message: locationErr?.message,
          stack: locationErr?.stack,
          alertId: alertId,
          senderUserId: alertData.user_id,
          receiverUserId: user.id
        })
        // Fallback to alert location (already set above, but ensure it's set)
        if (alertData.location_lat && alertData.location_lng && !location) {
          console.log('[Receiver] Using fallback alert location after exception')
          setLocation({
            id: 'initial',
            user_id: alertData.user_id,
            alert_id: alertId,
            latitude: alertData.location_lat,
            longitude: alertData.location_lng,
            timestamp: alertData.triggered_at,
            created_at: alertData.triggered_at,
          } as LocationHistory)
        }
      }
    } catch (error: any) {
      console.error('[Alert] ❌ Failed to load alert:', {
        error: error?.message || error,
        code: error?.code,
        alertId,
        userId: user?.id
      })
      router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }, [user, alertId, router])

  // Load all receiver locations (for showing all responders on map)
  const loadAllReceiverLocations = useCallback(async () => {
    if (!alert || !alert.id || !user || isClosingRef.current) {
      return
    }

    // Prevent concurrent calls
    if (loadingReceiverLocationsRef.current) {
      console.log('[Receiver] ⏸️ Already loading receiver locations, skipping')
      return
    }

    loadingReceiverLocationsRef.current = true

    try {
      console.log('[Receiver] 📍 Loading all receiver locations for alert:', alert.id)

      // Step 1: Fetch accepted responders
      const acceptedResponse = await fetch(`/api/emergency/${alert.id}/accepted-responders`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      })

      if (!acceptedResponse.ok && acceptedResponse.status !== 304) {
        const status = acceptedResponse.status
        let errorData: any = {}
        try {
          const responseText = await acceptedResponse.text()
          if (responseText && responseText.trim()) {
            errorData = JSON.parse(responseText)
          }
        } catch (parseError) {
          console.warn('[Receiver] Failed to parse error response:', parseError)
        }

        console.error('[Receiver] ❌ Failed to fetch accepted responders:', {
          status,
          error: errorData.error || `HTTP ${status}`,
          alertId: alert.id
        })

        setAllReceiverLocations(new Map())
        setAllReceiverUserIds([])
        setAcceptedResponderCount(0)
        loadingReceiverLocationsRef.current = false
        return
      }

      const acceptedData = await acceptedResponse.json()
      const acceptedResponses = acceptedData.acceptedResponders || []
      const acceptedCount = acceptedData.count || 0

      setAcceptedResponderCount(acceptedCount)

      if (acceptedCount === 0) {
        console.log('[Receiver] ℹ️ No accepted responders yet')
        setAllReceiverLocations(new Map())
        setAllReceiverUserIds([])
        loadingReceiverLocationsRef.current = false
        return
      }

      const acceptedUserIds = acceptedResponses.map((r: { contact_user_id: string }) => r.contact_user_id)
      console.log('[Receiver] ✅ Found accepted responders:', {
        count: acceptedCount,
        userIds: acceptedUserIds
      })

      // Step 2: Fetch all receiver locations
      const locationsResponse = await fetch(`/api/emergency/${alert.id}/receiver-locations`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      })

      if (!locationsResponse.ok && locationsResponse.status !== 304) {
        const errorData = await locationsResponse.json().catch(() => ({}))
        console.error('[Receiver] ❌ Failed to fetch receiver locations:', {
          status: locationsResponse.status,
          error: errorData.error || 'Unknown error',
          alertId: alert.id
        })
        setAllReceiverLocations(new Map())
        setAllReceiverUserIds([])
        loadingReceiverLocationsRef.current = false
        return
      }

      const locationsData = await locationsResponse.json()
      const groupedByUser = locationsData.groupedByUser || {}
      const allLocations = locationsData.receiverLocations || []

      console.log('[Receiver] 📍 Received location data from API:', {
        totalLocations: allLocations.length,
        groupedByUserKeys: Object.keys(groupedByUser),
        groupedByUserSize: Object.keys(groupedByUser).length,
        acceptedUserIds: acceptedUserIds
      })

      if (allLocations && allLocations.length > 0) {
        // Convert groupedByUser object to Map
        const receiverMap = new Map<string, LocationHistory[]>()
        const userIds = new Set<string>()

        Object.entries(groupedByUser).forEach(([receiverId, locations]: [string, any]) => {
          const locationArray = Array.isArray(locations) ? locations : []
          
          // Sort by created_at ascending (oldest first, newest last)
          const sortedLocations = [...locationArray].sort((a: LocationHistory, b: LocationHistory) => {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          })
          
          userIds.add(receiverId)
          receiverMap.set(receiverId, sortedLocations as LocationHistory[])
          console.log('[Receiver] 📍 Added receiver to map:', {
            receiverId: receiverId,
            locationCount: sortedLocations.length,
            latestLocation: sortedLocations.length > 0 ? {
              lat: sortedLocations[sortedLocations.length - 1].latitude,
              lng: sortedLocations[sortedLocations.length - 1].longitude,
              id: sortedLocations[sortedLocations.length - 1].id
            } : null
          })
        })

        console.log('[Receiver] 📍 Setting receiver locations state:', {
          mapSize: receiverMap.size,
          userIds: Array.from(userIds),
          receiverIds: Array.from(receiverMap.keys()),
          totalLocations: Array.from(receiverMap.values()).reduce((sum, locs) => sum + locs.length, 0)
        })

        setAllReceiverLocations(receiverMap)
        setAllReceiverUserIds(Array.from(userIds))
      } else {
        console.warn('[Receiver] ⚠️ No receiver locations found yet:', {
          acceptedUserIds: acceptedUserIds,
          alertId: alert.id,
          acceptedCount: acceptedCount
        })
        setAllReceiverLocations(new Map())
        setAllReceiverUserIds([])
      }
    } catch (error: any) {
      console.error('[Receiver] ❌ Error loading receiver locations:', {
        error: error,
        message: error?.message,
        stack: error?.stack,
        alertId: alert.id,
        userId: user.id
      })
      setAllReceiverLocations(new Map())
      setAllReceiverUserIds([])
    } finally {
      loadingReceiverLocationsRef.current = false
    }
  }, [alert, user])

  // Load photos and subscribe to photo updates
  useEffect(() => {
    if (!alert || !user) return

    // Load existing photos
    const loadPhotos = async () => {
      if (alert.id) {
        const alertPhotos = await getAlertPhotos(alert.id)
        setPhotos(alertPhotos)
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
          console.log('[Photo] ✅ New photo received:', payload.new)
          setPhotos((prev) => [payload.new as EmergencyPhoto, ...prev])
        }
      )
      .subscribe()

    return () => {
      photoSubscription.unsubscribe()
    }
  }, [alert, user])

  const handleDeclineResponse = useCallback(async () => {
    if (!user || !alert || declining || hasAccepted) return

    const confirmed = window.confirm('Are you sure you want to decline this emergency alert? You will not be able to help respond.')
    if (!confirmed) return

    setDeclining(true)
    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('alert_responses')
        .update({ declined_at: new Date().toISOString() })
        .eq('alert_id', alert.id)
        .eq('contact_user_id', user.id)

      if (error) {
        console.error('[Alert] Failed to decline response:', error)
        window.alert('Failed to decline response. Please try again.')
        setDeclining(false)
        return
      }

      setHasDeclined(true)
      setDeclining(false)
      console.log('[Alert] ✅ User declined to respond')
      
      // Navigate back to dashboard after declining
      setTimeout(() => {
        router.replace('/dashboard')
      }, 1000)
    } catch (error: any) {
      console.error('[Alert] Error declining response:', error)
      window.alert('Failed to decline response. Please try again.')
      setDeclining(false)
    }
  }, [user, alert, declining, hasAccepted, router])

  const handleAcceptResponse = useCallback(async () => {
    if (!user || !alert || accepting || hasDeclined) return

    setAccepting(true)
      const supabase = createClient()

    try {
      // Clear declined_at if it was set (user can change their mind)
      const { error } = await supabase
        .from('alert_responses')
        .update({ 
          acknowledged_at: new Date().toISOString(),
          declined_at: null // Clear declined status if accepting
        })
        .eq('alert_id', alert.id)
        .eq('contact_user_id', user.id)

      if (error) {
        console.error('[Alert] Failed to accept response:', error)
        window.alert('Failed to accept response. Please try again.')
        setAccepting(false)
        return
      }

      setHasAccepted(true)
      setAccepting(false)
      console.log('[Alert] ✅ User accepted to respond')
      
      // Load all receiver locations when user accepts (to show other responders)
      loadAllReceiverLocations()
      
      // Immediately save receiver's location to location_history when they accept
      // This ensures the sender can see the receiver's location right away
      try {
        const currentLoc = await getCurrentLocation()
        if (currentLoc) {
          const { updateLocation } = await import('@/lib/location')
          await updateLocation(user.id, alert.id, currentLoc)
          console.log('[Receiver] ✅ Saved initial location after acceptance:', {
            location: currentLoc,
            alertId: alert.id,
            userId: user.id,
            timestamp: new Date().toISOString()
          })
          
          // Verify location was saved by querying it back
          setTimeout(async () => {
            try {
              const supabase = createClient()
              const { data: savedLocation } = await supabase
                .from('location_history')
                .select('id, latitude, longitude, alert_id, user_id, created_at')
                .eq('alert_id', alert.id)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
              
              if (savedLocation) {
                console.log('[Receiver] ✅ Verified location saved in database:', {
                  locationId: savedLocation.id,
                  alertId: savedLocation.alert_id,
                  userId: savedLocation.user_id,
                  location: { lat: savedLocation.latitude, lng: savedLocation.longitude },
                  timestamp: savedLocation.created_at
                })
              } else {
                console.warn('[Receiver] ⚠️ Location not found in database after save - may be a timing issue')
              }
            } catch (verifyError) {
              console.warn('[Receiver] ⚠️ Could not verify location save:', verifyError)
            }
          }, 1000)
          // Also update local state so map shows immediately
          setReceiverLocation(currentLoc)
          setReceiverLastUpdate(new Date())
          
          // Start continuous location tracking immediately after acceptance
          // This ensures the sender gets live location updates
          startLocationTracking(
            user.id,
            alert.id,
            async (loc) => {
              setReceiverLocation(loc)
              setReceiverLastUpdate(new Date())
              setReceiverTrackingActive(true)
            },
            20000 // Update every 20 seconds
          )
          console.log('[Receiver] ✅ Started continuous location tracking after acceptance')
          setReceiverTrackingActive(true)
        } else {
          console.warn('[Receiver] ⚠️ Could not get current location to save after acceptance')
          // Still start tracking even if initial location failed
          startLocationTracking(
            user.id,
            alert.id,
            async (loc) => {
              setReceiverLocation(loc)
              setReceiverLastUpdate(new Date())
              setReceiverTrackingActive(true)
            },
            20000
          )
          setReceiverTrackingActive(true)
        }
      } catch (locError) {
        console.warn('[Receiver] ⚠️ Could not save initial location after acceptance:', locError)
        // Don't block acceptance if location save fails, but still try to start tracking
        try {
          startLocationTracking(
            user.id,
            alert.id,
            async (loc) => {
              setReceiverLocation(loc)
              setReceiverLastUpdate(new Date())
              setReceiverTrackingActive(true)
            },
            20000
          )
          setReceiverTrackingActive(true)
        } catch (trackError) {
          console.warn('[Receiver] ⚠️ Could not start location tracking:', trackError)
        }
      }
    } catch (error: any) {
      console.error('[Alert] Error accepting response:', error)
      window.alert('An error occurred. Please try again.')
      setAccepting(false)
    }
  }, [user, alert, accepting, loadAllReceiverLocations])

  useEffect(() => {
    // Wait for auth to finish loading before checking user
    if (authLoading) {
      return // Still loading, wait
    }

    // Only redirect if auth loading is complete and no user
    if (!user) {
      router.push('/auth/login')
      return
    }

    // Only call loadAlert once per alertId to prevent duplicate calls
    // Reset ref when alertId changes (user navigated to different alert)
    if (loadAlertCalledRef.current !== alertId) {
      loadAlertCalledRef.current = alertId
      loadAlert()
    }
    // Remove router from dependencies - it's stable and causes unnecessary re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, alertId, authLoading]) // Only depend on user.id, not user object or router - ref prevents duplicate calls

  useEffect(() => {
    if (!alert || !user) return
    
    // Only set up subscriptions once per alert ID
    if (subscriptionsSetupRef.current === alert.id) {
      return // Already set up for this alert ID
    }
    
    subscriptionsSetupRef.current = alert.id

    // Get receiver's current location for directions (even if not accepted yet)
    // This allows directions to be shown from receiver to sender
    // Also ensures receiver's location is visible on their own map
    getCurrentLocation()
      .then((loc) => {
        if (loc) {
          setReceiverLocation(loc)
          setReceiverLastUpdate(new Date())
          console.log('[Receiver] ✅ Got current location for directions and map display:', loc)
        } else {
          console.warn('[Receiver] ⚠️ Could not get current location (returned null)')
        }
      })
      .catch((error) => {
        console.warn('[Receiver] ⚠️ Could not get current location for directions:', error)
        // Location unavailable - that's ok, directions won't show
      })

    // Only start location tracking if user has accepted to respond
    let stopReceiverTracking: (() => void) | null = null
    
    if (hasAccepted) {
      // Start tracking receiver's own location (for sharing with sender)
      stopReceiverTracking = startLocationTracking(
        user.id,
        alert.id,
        async (loc) => {
          setReceiverLocation(loc)
          setReceiverLastUpdate(new Date())
          setReceiverTrackingActive(true)
        },
        20000 // Update every 20 seconds
      )
      
      setReceiverTrackingActive(true)
    } else {
      setReceiverTrackingActive(false)
    }

    // Subscribe to location updates (both sender and receiver)
    const unsubscribeLocation = subscribeToLocationHistory(alert.id, (newLocation) => {
      // Don't process updates if we're closing
      if (isClosingRef.current) return
      console.log('[Receiver] Location update received via subscription:', {
        userId: newLocation.user_id,
        alertUserId: alert.user_id,
        receiverUserId: user.id,
        isSender: newLocation.user_id === alert.user_id,
        isReceiver: newLocation.user_id === user.id,
        location: { lat: newLocation.latitude, lng: newLocation.longitude }
      })
      
      // Check if this is sender's location, own location, or another receiver's location
      if (newLocation.user_id === alert.user_id) {
        // This is sender's location
        console.log('[Receiver] ✅ Updating sender location from subscription:', {
          lat: newLocation.latitude,
          lng: newLocation.longitude,
          timestamp: newLocation.created_at
        })
        setLocationHistory((prev) => [...prev, newLocation])
        setLocation(newLocation)
      } else if (newLocation.user_id === user.id) {
        // This is receiver's own location
        console.log('[Receiver] ✅ Updating own location from subscription:', {
          lat: newLocation.latitude,
          lng: newLocation.longitude,
          timestamp: newLocation.created_at
        })
        setReceiverLocationHistory((prev) => [...prev, newLocation])
        setReceiverLocation({
          lat: newLocation.latitude,
          lng: newLocation.longitude,
        })
        setReceiverLastUpdate(new Date())
      } else {
        // This is another receiver's location - add to allReceiverLocations
        console.log('[Receiver] ✅ Updating other receiver location from subscription:', {
          receiverId: newLocation.user_id,
          lat: newLocation.latitude,
          lng: newLocation.longitude,
          timestamp: newLocation.created_at
        })
        
        // Update allReceiverLocations Map
        setAllReceiverLocations((prev) => {
          const updated = new Map(prev)
          const receiverId = newLocation.user_id
          
          // Add receiver to map if not already present
          if (!updated.has(receiverId)) {
            updated.set(receiverId, [])
            setAllReceiverUserIds((prevIds) => {
              if (!prevIds.includes(receiverId)) {
                console.log('[Receiver] ✅ Added new receiver to map:', receiverId)
                return [...prevIds, receiverId]
              }
              return prevIds
            })
          }
          
          // Get existing locations for this receiver
          const receiverHistory = updated.get(receiverId) || []
          
          // Check if this location already exists (avoid duplicates)
          const exists = receiverHistory.some(loc => loc.id === newLocation.id)
          if (!exists) {
            // Add new location and sort by created_at (ascending - oldest first, newest last)
            const updatedHistory = [...receiverHistory, newLocation].sort((a, b) => {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            })
            updated.set(receiverId, updatedHistory)
            
            console.log('[Receiver] ✅ Updated receiver locations:', {
              receiverId,
              previousCount: receiverHistory.length,
              newCount: updatedHistory.length,
              latestLocation: updatedHistory.length > 0 ? {
                lat: updatedHistory[updatedHistory.length - 1].latitude,
                lng: updatedHistory[updatedHistory.length - 1].longitude,
                id: updatedHistory[updatedHistory.length - 1].id
              } : null
            })
          } else {
            console.log('[Receiver] ⚠️ Location already exists, skipping:', {
              receiverId,
              locationId: newLocation.id
            })
          }
          
          return updated
        })
      }
    })

    // Add polling fallback for location updates (in case subscription fails)
    // Poll every 10 seconds for sender's location updates
    const pollInterval = setInterval(async () => {
      if (!alert || !user || isClosingRef.current) return
      
      try {
        const supabase = createClient()
        const { data: latestLocation, error: pollError } = await supabase
          .from('location_history')
          .select('*')
          .eq('alert_id', alert.id)
          .eq('user_id', alert.user_id) // Get sender's latest location
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (pollError) {
          // Silently ignore polling errors (subscription should handle updates)
          return
        }
        
        if (latestLocation) {
          // Check if this is a new location (not already in history)
          setLocationHistory((prev) => {
            const exists = prev.some(loc => loc.id === latestLocation.id)
            if (!exists) {
              console.log('[Receiver] Polling found new sender location')
              setLocation(latestLocation)
              return [...prev, latestLocation]
            }
            return prev
          })
        }
      } catch (pollErr) {
        // Silently ignore polling errors
        console.warn('[Receiver] Polling error (non-critical):', pollErr)
      }
    }, 10000) // Poll every 10 seconds

    // Subscribe to alert updates
    const unsubscribeAlert = createClient()
      ?.channel(`alert-status-${alert.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'emergency_alerts',
          filter: `id=eq.${alert.id}`,
        },
        (payload: any) => {
          // Don't process updates if we're closing
          if (isClosingRef.current) return
          
          const updatedAlert = payload.new as EmergencyAlert
          console.log('[Receiver] ✅ Alert status update received:', {
            alertId: alert.id,
            oldStatus: alert.status,
            newStatus: updatedAlert.status
          })
          setAlert(updatedAlert)
          if (updatedAlert.status !== 'active') {
            console.log('[Receiver] ✅ Alert cancelled/resolved - redirecting to dashboard')
            hideEmergencyAlert()
            // Use replace instead of push to prevent back navigation
            router.replace('/dashboard')
          }
        }
      )
      .subscribe()
    
    // Add polling fallback to check alert status (in case subscription fails)
    // Poll every 5 seconds to check if alert was cancelled
    const statusPollInterval = setInterval(async () => {
      if (!alert || !user || isClosingRef.current) return
      
      try {
        const supabase = createClient()
        const { data: currentAlert, error: pollError } = await supabase
          .from('emergency_alerts')
          .select('id, status')
          .eq('id', alert.id)
          .single()
        
        if (pollError) {
          // Silently ignore polling errors (subscription should handle updates)
          return
        }
        
        if (currentAlert && currentAlert.status !== 'active') {
          console.log('[Receiver] ✅ Polling detected alert cancelled/resolved - redirecting to dashboard')
          hideEmergencyAlert()
          router.replace('/dashboard')
        }
      } catch (pollErr) {
        // Silently ignore polling errors
        console.warn('[Receiver] Polling error (non-critical):', pollErr)
      }
    }, 5000) // Poll every 5 seconds

    // Add polling fallback to refresh all receiver locations (in case subscription fails)
    // Poll every 45 seconds to refresh receiver locations
    const receiverLocationsPollInterval = setInterval(async () => {
      if (!alert || !user || isClosingRef.current) return
      
      try {
        console.log('[Receiver] 🔄 Polling: Refreshing all receiver locations...')
        await loadAllReceiverLocations()
      } catch (pollErr) {
        // Silently ignore polling errors
        console.warn('[Receiver] Polling error refreshing receiver locations (non-critical):', pollErr)
      }
    }, 45000) // Poll every 45 seconds

    // Load all receiver locations initially and when user accepts
    if (hasAccepted) {
      // Load immediately if user has accepted
      loadAllReceiverLocations()
    }

    // Store cleanup functions in ref for X button handler
    cleanupRefs.current = {
      unsubscribeLocation,
      unsubscribeAlert: unsubscribeAlert?.unsubscribe.bind(unsubscribeAlert),
      pollInterval,
      statusPollInterval,
      receiverLocationsPollInterval,
      stopReceiverTracking: stopReceiverTracking || undefined
    }


    // Play alert sound and vibrate device
    playAlertSound()
    vibrateDevice()

    return () => {
      // DON'T reset subscriptionsSetupRef to null - keep it set to prevent re-subscription
      // subscriptionsSetupRef.current = null
      if (stopReceiverTracking) {
        stopReceiverTracking()
      }
      setReceiverTrackingActive(false)
      unsubscribeLocation()
      unsubscribeAlert?.unsubscribe()
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      if (statusPollInterval) {
        clearInterval(statusPollInterval)
      }
      if (receiverLocationsPollInterval) {
        clearInterval(receiverLocationsPollInterval)
      }
      hideEmergencyAlert()
      // Clear cleanup refs
      cleanupRefs.current = {}
    }
    // Only depend on alert.id and user.id, not the full alert object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id, user?.id, router, permissionStatus, hasAccepted, loadAllReceiverLocations])

  // Load receiver locations when alert is loaded (even before acceptance, to see who else is responding)
  useEffect(() => {
    if (alert && alert.id && user && !isClosingRef.current) {
      // Load receiver locations after a short delay to ensure alert is fully loaded
      const timer = setTimeout(() => {
        loadAllReceiverLocations()
      }, 1000) // 1 second delay to ensure alert state is stable
      
      return () => clearTimeout(timer)
    }
  }, [alert?.id, user?.id, loadAllReceiverLocations])

  // Ensure overlay is hidden when on alert page
  useEffect(() => {
    hideEmergencyAlert()
  }, [])

  // Auto-redirect if alert is cancelled/resolved
  useEffect(() => {
    if (alert && alert.status !== 'active' && !isClosingRef.current) {
      console.log('[Receiver] Alert is not active, auto-redirecting to dashboard', {
        alertId: alert.id,
        status: alert.status
      })
      setIsClosing(true)
      isClosingRef.current = true
      
      // Clean up subscriptions
      try {
        if (cleanupRefs.current.stopReceiverTracking) {
          cleanupRefs.current.stopReceiverTracking()
        }
        if (cleanupRefs.current.unsubscribeLocation) {
          cleanupRefs.current.unsubscribeLocation()
        }
        if (cleanupRefs.current.unsubscribeAlert) {
          cleanupRefs.current.unsubscribeAlert()
        }
        if (cleanupRefs.current.pollInterval) {
          clearInterval(cleanupRefs.current.pollInterval)
        }
        if (cleanupRefs.current.statusPollInterval) {
          clearInterval(cleanupRefs.current.statusPollInterval)
        }
      } catch (cleanupError) {
        console.warn('[Receiver] Error during auto-cleanup:', cleanupError)
      }
      
      hideEmergencyAlert()
      
      // Force navigation with small delay to ensure cleanup completes
      setTimeout(() => {
        if (window.location.pathname !== '/dashboard') {
          console.log('[Receiver] Force navigating to dashboard')
          window.location.href = '/dashboard'
        }
      }, 100)
    }
  }, [alert?.status, alert?.id])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">PSP</h1>
          <p className="text-white/90">Loading alert...</p>
        </div>
      </div>
    )
  }

  if (!alert) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
        <Card className="w-full max-w-md">
          <div className="text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Alert Not Found</h2>
            <p className="text-gray-600 mb-4">This alert may have been cancelled or does not exist.</p>
            <Button onClick={() => router.push('/dashboard')} variant="primary">
              Go to Dashboard
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4">
      <Card className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500" />
            <div>
            <h1 className="text-2xl font-bold">Emergency Alert</h1>
              {senderName || senderEmail ? (
                <p className="text-sm text-gray-600">From: {senderName || senderEmail}</p>
              ) : null}
            </div>
          </div>
          <Button 
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              
              console.log('[Receiver] X button clicked - START', {
                isClosing: isClosing,
                isClosingRef: isClosingRef.current,
                hasRouter: !!router
              })
              
              // Prevent multiple close attempts
              if (isClosingRef.current) {
                console.log('[Receiver] Already closing, ignoring click')
                return
              }
              
              setIsClosing(true)
              isClosingRef.current = true
              
              console.log('[Receiver] X button clicked - cleaning up and navigating')
              
              // Clean up all subscriptions and intervals
              try {
                if (cleanupRefs.current.stopReceiverTracking) {
                  cleanupRefs.current.stopReceiverTracking()
                }
                if (cleanupRefs.current.unsubscribeLocation) {
                  cleanupRefs.current.unsubscribeLocation()
                }
                if (cleanupRefs.current.unsubscribeAlert) {
                  cleanupRefs.current.unsubscribeAlert()
                }
                if (cleanupRefs.current.pollInterval) {
                  clearInterval(cleanupRefs.current.pollInterval)
                }
                if (cleanupRefs.current.statusPollInterval) {
                  clearInterval(cleanupRefs.current.statusPollInterval)
                }
              } catch (cleanupError) {
                console.warn('[Receiver] Error during cleanup:', cleanupError)
              }
              
            // Hide alert overlay
            hideEmergencyAlert()
            
            // Navigate immediately - use replace to prevent back navigation
            // Use window.location.href as fallback if router fails
            console.log('[Receiver] Navigating to dashboard...')
            try {
              router.replace('/dashboard')
              // Fallback: if navigation doesn't happen within 500ms, force it
              setTimeout(() => {
                if (window.location.pathname !== '/dashboard') {
                  console.log('[Receiver] Router navigation failed, using window.location')
                  window.location.href = '/dashboard'
                }
              }, 500)
            } catch (navError) {
              console.error('[Receiver] Navigation error:', navError)
              // Force navigation as fallback
              window.location.href = '/dashboard'
            }
            }} 
            variant="secondary" 
            size="sm"
            className="flex-shrink-0 relative z-50"
            disabled={isClosing}
            type="button"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <p className="text-sm text-gray-600 mb-1">Alert Type</p>
            <p className="font-medium">
              {alert.alert_type.replace('_', ' ')}
            </p>
          </div>

          {!hasAccepted && !hasDeclined && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-gray-700 mb-3">
                Choose how you want to respond to this emergency alert.
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={handleAcceptResponse}
                  disabled={accepting || declining}
                  variant="primary"
                  size="lg"
                  className="flex-1"
                >
                  {accepting ? 'Accepting...' : 'Accept to Respond'}
                </Button>
                <Button
                  onClick={handleDeclineResponse}
                  disabled={accepting || declining}
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                >
                  {declining ? 'Declining...' : 'Decline'}
                </Button>
              </div>
            </div>
          )}

          {hasAccepted && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-700 font-medium">
                ✓ You're responding - Your location is being shared
              </p>
            </div>
          )}

          {hasDeclined && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-700 font-medium">
                You have declined to respond to this alert.
              </p>
            </div>
          )}

          {alert.address && (
            <div>
              <p className="text-sm text-gray-600 mb-1">Location</p>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-gray-400" />
                <p className="font-medium">{alert.address}</p>
              </div>
            </div>
          )}

          {location && (
            <div>
              <p className="text-sm text-gray-600 mb-1">Current Location</p>
              <p className="font-mono text-sm">
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </p>
            </div>
          )}
        </div>

        {alert && user && (location || alert.location_lat) && (
          <div className="mb-6">
            <div style={{ height: '400px', width: '100%' }}>
            <GoogleMapComponent
              latitude={location?.latitude || alert.location_lat || 0}
              longitude={location?.longitude || alert.location_lng || 0}
              alertId={alert.id}
              user_id={alert.user_id}
              receiverLocation={receiverLocation}
              receiverLocationHistory={receiverLocationHistory}
              receiverUserId={user.id}
              senderUserId={alert.user_id}
              receiverLocations={allReceiverLocations}
              receiverUserIds={allReceiverUserIds}
            />
            </div>
            {receiverLocation && location && (
              <div className="mt-4">
                <a
                  href={`https://www.google.com/maps/dir/${receiverLocation.lat},${receiverLocation.lng}/${location.latitude},${location.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <MapPin className="w-4 h-4" />
                  Open in Google Maps
                </a>
              </div>
            )}
            {!receiverLocation && (
              <div className="mt-2 text-sm text-yellow-600 bg-yellow-50 p-2 rounded">
                ⚠️ Your location is not available. Please enable location permissions to see directions.
              </div>
            )}
          </div>
        )}

        {/* Photo Gallery */}
        {photos.length > 0 && (
          <Card className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Camera className="w-5 h-5 text-gray-600" />
              <h2 className="text-xl font-bold text-gray-900">Photos from Emergency ({photos.length})</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative aspect-square rounded-lg overflow-hidden bg-gray-200 border-2 border-gray-300 cursor-pointer hover:border-blue-500 transition-colors"
                  onClick={() => {
                    // Open photo in full screen
                    window.open(getPhotoUrl(photo.storage_path), '_blank')
                  }}
                >
                  <img
                    src={getPhotoUrl(photo.storage_path)}
                    alt={`Emergency photo ${new Date(photo.created_at).toLocaleTimeString()}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-2 text-center">
                    {new Date(photo.created_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">Click a photo to view full size</p>
          </Card>
        )}
      </Card>
    </div>
  )
}

