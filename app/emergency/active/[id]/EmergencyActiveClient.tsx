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
  
  // Refs for delayed retry mechanism (Phase 1)
  const acceptanceRetryTimeout1Ref = useRef<NodeJS.Timeout | null>(null) // 2-second retry
  const acceptanceRetryTimeout2Ref = useRef<NodeJS.Timeout | null>(null) // 5-second retry
  
  // Refs for enhanced polling mode (Phase 2)
  const enhancedPollingRef = useRef(false) // Boolean flag for enhanced mode
  const enhancedPollingTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Timeout to disable enhanced mode
  const enhancedPollingStartTimeRef = useRef<number | null>(null) // Track when enhanced mode started
  const acceptancePollTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Recursive polling timeout
  
  // Phase 5: Track recent acceptances to prevent duplicate retries
  const recentAcceptancesRef = useRef<Map<string, number>>(new Map()) // Map of user ID -> timestamp
  
  // Polling refs (must be at top level, not inside useEffect)
  const pollingAttemptRef = useRef(0) // Track polling attempts for exponential backoff

  // Update addressRef when address changes (doesn't trigger loadAlert)
  useEffect(() => {
    addressRef.current = address
  }, [address])
  
  // Phase 4: Track state changes for diagnostics
  useEffect(() => {
    console.log('[DIAG] [Sender] 📊 Checkpoint 1.3 - State Actually Updated (React):', {
      receiverLocationsSize: receiverLocations.size,
      receiverLocationsKeys: Array.from(receiverLocations.keys()),
      receiverUserIds: receiverUserIds,
      timestamp: new Date().toISOString(),
      locationsPerReceiver: Array.from(receiverLocations.entries()).map(([id, locs]) => ({
        receiverId: id,
        locationCount: locs.length,
        latestLocation: locs.length > 0 ? {
          lat: locs[locs.length - 1].latitude,
          lng: locs[locs.length - 1].longitude,
          id: locs[locs.length - 1].id
        } : null
      }))
    })
  }, [receiverLocations, receiverUserIds])

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
        // PHANTOM ALERT FIX: Check if alert is stale (older than 24 hours) and auto-cancel
        const alertAge = activeAlert.triggered_at ? new Date(activeAlert.triggered_at).getTime() : 0
        const now = Date.now()
        const ageInHours = (now - alertAge) / (1000 * 60 * 60)
        const MAX_ALERT_AGE_HOURS = 24 // Cancel alerts older than 24 hours
        
        if (ageInHours > MAX_ALERT_AGE_HOURS) {
          console.warn('[Emergency Active] ⚠️ PHANTOM ALERT DETECTED: Stale alert found, auto-cancelling:', {
            id: activeAlert.id,
            ageInHours: ageInHours.toFixed(2),
            triggeredAt: activeAlert.triggered_at,
            maxAge: MAX_ALERT_AGE_HOURS
          })
          
          // Auto-cancel the stale alert
          try {
            const { cancelEmergencyAlert } = await import('@/lib/services/emergency')
            await cancelEmergencyAlert(activeAlert.id)
            console.log('[Emergency Active] ✅ Successfully cancelled stale alert, redirecting to dashboard')
            router.push('/dashboard')
            return
          } catch (cancelError: any) {
            console.error('[Emergency Active] ❌ Failed to auto-cancel stale alert:', cancelError)
            // If cancellation fails, redirect to dashboard anyway
            router.push('/dashboard')
            return
          }
        }
        
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
    // Only run if we have both alert and user
    if (!alert || !user) {
      return
    }
    
    console.log('[DIAG] [Sender] 🚀 useEffect for receiver locations ENTRY POINT', {
      hasAlert: !!alert,
      alertId: alert?.id,
      hasUser: !!user,
      userId: user?.id,
      urlAlertId: alertId,
      timestamp: new Date().toISOString()
    })

    // Check location permission before starting tracking
    if (permissionStatus === 'denied' || permissionStatus === 'prompt') {
      setShowPermissionPrompt(true)
    } else if (permissionStatus === 'granted') {
      setShowPermissionPrompt(false)
    }

    // REMOVED: RLS verification - was causing React error #321
    // RLS verification is now handled via API fallback in loadReceiverLocations

    // HYBRID FIX: Try direct Supabase query first, fall back to API if RLS blocks
    // This ensures it works regardless of RLS policy migration status
    const loadReceiverLocations = async () => {
      const diagStartTime = Date.now()
      const timingCheckpoints: Record<string, number> = { start: diagStartTime }
      
      console.log('[DIAG] [Sender] 🚀 HYBRID FIX - loadReceiverLocations ENTRY POINT', {
        hasAlert: !!alert,
        alertId: alert?.id,
        urlAlertId: alertId,
        userId: user?.id,
        uploadingPhoto: uploadingPhotoRef.current,
        timestamp: new Date().toISOString(),
        currentReceiverLocationsSize: receiverLocations.size,
        currentReceiverUserIds: receiverUserIds
      })
      
      // Enhanced guard check - ensure alert exists AND ID matches URL
      if (!alert || !alert.id) {
        console.warn('[Sender] ⚠️ Cannot load receiver locations - alert not available', {
          hasAlert: !!alert,
          alertId: alert?.id,
          urlAlertId: alertId
        })
        return
      }
      
      // Verify alert ID matches URL parameter
      if (alert.id !== alertId) {
        console.warn('[Sender] ⚠️ Alert ID mismatch - waiting for correct alert', {
          alertId: alert.id,
          urlAlertId: alertId
        })
        return
      }
      
      // Don't reload locations if photo upload is in progress
      if (uploadingPhotoRef.current) {
        console.log('[Sender] ⏸️ Deferring location reload - photo upload in progress')
        loadLocationsQueuedRef.current = true
        return
      }
      
      // Helper function to detect RLS errors
      const isRLSError = (error: any): boolean => {
        if (!error) return false
        return error.code === '42501' || 
               error.message?.toLowerCase().includes('row-level security') ||
               error.message?.toLowerCase().includes('rls') ||
               error.hint?.toLowerCase().includes('row-level security') ||
               error.hint?.toLowerCase().includes('rls')
      }
      
      // Helper function to load via API fallback
      const loadViaAPI = async (): Promise<{ acceptedUserIds: string[], locations: LocationHistory[] } | null> => {
        console.log('[DIAG] [Sender] 🔄 HYBRID FIX - Falling back to API endpoints', {
          alertId: alert.id,
          timestamp: new Date().toISOString()
        })
        
        try {
          // Step 1: Get accepted responders via API
          const acceptedResponse = await fetch(`/api/emergency/${alert.id}/accepted-responders`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          })
          
          if (!acceptedResponse.ok) {
            const errorData = await acceptedResponse.json().catch(() => ({}))
            console.error('[Sender] ❌ HYBRID FIX - API fallback failed for accepted responders:', {
              status: acceptedResponse.status,
              error: errorData.error || errorData.details,
              alertId: alert.id
            })
            return null
          }
          
          const acceptedData = await acceptedResponse.json()
          const acceptedUserIds = acceptedData.acceptedResponders?.map((r: any) => r.contact_user_id) || []
          
          console.log('[DIAG] [Sender] ✅ HYBRID FIX - API fallback: Got accepted responders', {
            count: acceptedUserIds.length,
            userIds: acceptedUserIds,
            alertId: alert.id
          })
          
          if (acceptedUserIds.length === 0) {
            return { acceptedUserIds: [], locations: [] }
          }
          
          // Step 2: Get locations via API
          const locationsResponse = await fetch(`/api/emergency/${alert.id}/receiver-locations`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          })
          
          if (!locationsResponse.ok) {
            const errorData = await locationsResponse.json().catch(() => ({}))
            console.error('[Sender] ❌ HYBRID FIX - API fallback failed for locations:', {
              status: locationsResponse.status,
              error: errorData.error || errorData.details,
              alertId: alert.id
            })
            return { acceptedUserIds, locations: [] }
          }
          
          const locationsData = await locationsResponse.json()
          const locations = locationsData.receiverLocations || []
          
          console.log('[DIAG] [Sender] ✅ HYBRID FIX - API fallback: Got locations', {
            locationCount: locations.length,
            alertId: alert.id
          })
          
          return { acceptedUserIds, locations }
        } catch (apiError: any) {
          console.error('[Sender] ❌ HYBRID FIX - API fallback exception:', {
            error: apiError?.message || apiError,
            stack: apiError?.stack,
            alertId: alert.id
          })
          return null
        }
      }
      
      try {
        const supabase = createClient()
        const queryStartTime = Date.now()
        timingCheckpoints.queryStart = queryStartTime
        
        console.log('[DIAG] [Sender] 🔍 HYBRID FIX - Step 1: Attempting direct Supabase query for accepted responders', {
          alertId: alert.id,
          userId: user.id,
          timestamp: new Date().toISOString()
        })
        
        // Step 1: Try direct Supabase query for accepted responders
        const { data: acceptedResponses, error: responsesError } = await supabase
          .from('alert_responses')
          .select('contact_user_id, acknowledged_at, declined_at')
          .eq('alert_id', alert.id)
          .not('acknowledged_at', 'is', null)
          .is('declined_at', null)
          .order('acknowledged_at', { ascending: false })
        
        const queryEndTime = Date.now()
        timingCheckpoints.queryEnd = queryEndTime
        timingCheckpoints.queryDuration = queryEndTime - queryStartTime
        
        // Check if RLS blocked the query
        if (responsesError && isRLSError(responsesError)) {
          console.error('[Sender] ❌ HYBRID FIX - RLS policy blocked direct query, using API fallback', {
            error: responsesError,
            code: responsesError.code,
            message: responsesError.message,
            hint: responsesError.hint,
            alertId: alert.id,
            userId: user.id,
            timestamp: new Date().toISOString()
          })
          
          // Fall back to API
          const apiResult = await loadViaAPI()
          if (!apiResult) {
            console.error('[Sender] ❌ HYBRID FIX - Both direct query and API fallback failed')
            return
          }
          
          const { acceptedUserIds, locations } = apiResult
          const acceptedCount = acceptedUserIds.length
          
          // Update accepted responder count
          setAcceptedResponderCount(acceptedCount)
          
          if (acceptedCount === 0) {
            console.log('[DIAG] [Sender] ⚠️ No accepted responders (via API) - clearing locations state')
            setReceiverLocations(new Map())
            setReceiverUserIds([])
            return
          }
          
          // Process locations from API
          if (locations && locations.length > 0) {
            const groupedByUser: Record<string, LocationHistory[]> = {}
            locations.forEach((loc: LocationHistory) => {
              const receiverId = loc.user_id
              if (!groupedByUser[receiverId]) {
                groupedByUser[receiverId] = []
              }
              groupedByUser[receiverId].push(loc)
            })
            
            const receiverMap = new Map<string, LocationHistory[]>()
            const userIds = new Set<string>()
            
            Object.entries(groupedByUser).forEach(([receiverId, locationArray]) => {
              const sortedLocations = [...locationArray].sort((a: LocationHistory, b: LocationHistory) => {
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              })
              userIds.add(receiverId)
              receiverMap.set(receiverId, sortedLocations)
            })
            
            console.log('[DIAG] [Sender] ✅ HYBRID FIX - API fallback: Updating state', {
              receiverCount: receiverMap.size,
              receiverIds: Array.from(userIds),
              totalLocations: locations.length,
              method: 'API_FALLBACK'
            })
            
            setReceiverLocations(receiverMap)
            setReceiverUserIds(Array.from(userIds))
          } else {
            setReceiverLocations(new Map())
            setReceiverUserIds([])
          }
          
          return
        }
        
        // If error but not RLS, log and return
        if (responsesError) {
          console.error('[Sender] ❌ HYBRID FIX - Non-RLS error querying accepted responders:', {
            error: responsesError,
            code: responsesError.code,
            message: responsesError.message,
            hint: responsesError.hint,
            alertId: alert.id,
            userId: user.id,
            timestamp: new Date().toISOString()
          })
          return
        }
        
        console.log('[DIAG] [Sender] ✅ HYBRID FIX - Step 1 Result: Direct query succeeded', {
          count: acceptedResponses?.length || 0,
          responderIds: acceptedResponses?.map((r: any) => r.contact_user_id) || [],
          duration: `${queryEndTime - queryStartTime}ms`,
          method: 'DIRECT_QUERY',
          timestamp: new Date().toISOString()
        })
        
        const acceptedCount = acceptedResponses?.length || 0
        const acceptedUserIds = acceptedResponses?.map((r: any) => r.contact_user_id) || []
        
        // Update accepted responder count
        setAcceptedResponderCount(acceptedCount)
        
        // If no accepted responders, clear the map
        if (acceptedCount === 0) {
          console.log('[DIAG] [Sender] ⚠️ No accepted responders - clearing locations state', {
            timestamp: new Date().toISOString()
          })
          setReceiverLocations(new Map())
          setReceiverUserIds([])
          return
        }
        
        console.log('[DIAG] [Sender] ✅ HYBRID FIX - Step 2: Querying locations for accepted responders', {
          acceptedUserIds: acceptedUserIds,
          acceptedCount: acceptedCount,
          alertId: alert.id,
          timestamp: new Date().toISOString()
        })
        
        // Step 2: Try direct Supabase query for locations
        const locationsQueryStartTime = Date.now()
        timingCheckpoints.locationsQueryStart = locationsQueryStartTime
        
        const { data: locations, error: locationsError } = await supabase
          .from('location_history')
          .select('*')
          .eq('alert_id', alert.id)
          .in('user_id', acceptedUserIds)
          .order('created_at', { ascending: false })
          .limit(100)
        
        const locationsQueryEndTime = Date.now()
        timingCheckpoints.locationsQueryEnd = locationsQueryEndTime
        timingCheckpoints.locationsQueryDuration = locationsQueryEndTime - locationsQueryStartTime
        
        // Check if RLS blocked the query
        if (locationsError && isRLSError(locationsError)) {
          console.error('[Sender] ❌ HYBRID FIX - RLS policy blocked location query, using API fallback', {
            error: locationsError,
            code: locationsError.code,
            message: locationsError.message,
            hint: locationsError.hint,
            alertId: alert.id,
            userId: user.id,
            timestamp: new Date().toISOString()
          })
          
          // Fall back to API for locations only
          const apiResult = await loadViaAPI()
          if (apiResult && apiResult.locations.length > 0) {
            const groupedByUser: Record<string, LocationHistory[]> = {}
            apiResult.locations.forEach((loc: LocationHistory) => {
              const receiverId = loc.user_id
              if (!groupedByUser[receiverId]) {
                groupedByUser[receiverId] = []
              }
              groupedByUser[receiverId].push(loc)
            })
            
            const receiverMap = new Map<string, LocationHistory[]>()
            const userIds = new Set<string>()
            
            Object.entries(groupedByUser).forEach(([receiverId, locationArray]) => {
              const sortedLocations = [...locationArray].sort((a: LocationHistory, b: LocationHistory) => {
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              })
              userIds.add(receiverId)
              receiverMap.set(receiverId, sortedLocations)
            })
            
            console.log('[DIAG] [Sender] ✅ HYBRID FIX - API fallback for locations: Updating state', {
              receiverCount: receiverMap.size,
              receiverIds: Array.from(userIds),
              totalLocations: apiResult.locations.length,
              method: 'API_FALLBACK_LOCATIONS'
            })
            
            setReceiverLocations(receiverMap)
            setReceiverUserIds(Array.from(userIds))
          }
          
          return
        }
        
        // If error but not RLS, log and return
        if (locationsError) {
          console.error('[Sender] ❌ HYBRID FIX - Non-RLS error querying locations:', {
            error: locationsError,
            code: locationsError.code,
            message: locationsError.message,
            hint: locationsError.hint,
            alertId: alert.id,
            userId: user.id,
            timestamp: new Date().toISOString()
          })
          return
        }
        
        console.log('[DIAG] [Sender] ✅ HYBRID FIX - Step 2 Result: Direct query succeeded', {
          locationCount: locations?.length || 0,
          duration: `${locationsQueryEndTime - locationsQueryStartTime}ms`,
          method: 'DIRECT_QUERY',
          timestamp: new Date().toISOString()
        })
        
        // Step 3: Group locations by user_id
        const groupedByUser: Record<string, LocationHistory[]> = {}
        locations?.forEach((loc: LocationHistory) => {
          const receiverId = loc.user_id
          if (!groupedByUser[receiverId]) {
            groupedByUser[receiverId] = []
          }
          groupedByUser[receiverId].push(loc)
        })
        
        console.log('[DIAG] [Sender] ✅ HYBRID FIX - Step 3: Grouped locations by user', {
          totalLocations: locations?.length || 0,
          uniqueReceivers: Object.keys(groupedByUser).length,
          receivers: Object.keys(groupedByUser).map(receiverId => ({
            receiverId,
            locationCount: groupedByUser[receiverId].length
          })),
          timestamp: new Date().toISOString()
        })
        
        if (locations && locations.length > 0) {
          // Convert groupedByUser object to Map
          const receiverMap = new Map<string, LocationHistory[]>()
          const userIds = new Set<string>()

          Object.entries(groupedByUser).forEach(([receiverId, locationArray]) => {
            // Sort by created_at ascending (oldest first, newest last)
            const sortedLocations = [...locationArray].sort((a: LocationHistory, b: LocationHistory) => {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            })
            
            userIds.add(receiverId)
            receiverMap.set(receiverId, sortedLocations)
            console.log('[Sender] 📍 Added receiver to map:', {
              receiverId: receiverId,
              locationCount: sortedLocations.length,
              latestLocation: sortedLocations.length > 0 ? {
                lat: sortedLocations[sortedLocations.length - 1].latitude,
                lng: sortedLocations[sortedLocations.length - 1].longitude,
                id: sortedLocations[sortedLocations.length - 1].id
              } : null
            })
          })

          const stateUpdateTime = Date.now()
          timingCheckpoints.stateUpdate = stateUpdateTime
          timingCheckpoints.totalDuration = stateUpdateTime - diagStartTime
          
          console.log('[DIAG] [Sender] ✅ HYBRID FIX - Step 4: Updating state (DIRECT_QUERY)', {
            receiverCount: receiverMap.size,
            receiverIds: Array.from(userIds),
            totalLocations: Array.from(receiverMap.values()).reduce((sum, locs) => sum + locs.length, 0),
            timestamp: new Date().toISOString(),
            totalDuration: `${stateUpdateTime - diagStartTime}ms`,
            method: 'DIRECT_QUERY',
            timingBreakdown: {
              queryDuration: `${timingCheckpoints.queryDuration}ms`,
              locationsQueryDuration: `${timingCheckpoints.locationsQueryDuration}ms`
            }
          })

          setReceiverLocations(receiverMap)
          setReceiverUserIds(Array.from(userIds))
        } else {
          console.warn('[Sender] ⚠️ No receiver locations found yet (accepted responders exist but no locations saved):', {
            acceptedUserIds: acceptedUserIds,
            alertId: alert.id,
            acceptedCount: acceptedCount
          })
          // Keep accepted count but clear locations
          setReceiverLocations(new Map())
          setReceiverUserIds([])
        }
      } catch (error: any) {
        console.error('[Sender] ❌ HYBRID FIX - Unexpected error:', {
          error: error,
          message: error?.message,
          name: error?.name,
          stack: error?.stack,
          alertId: alert.id,
          userId: user.id,
          timestamp: new Date().toISOString()
        })
        // Don't clear state - keep existing data
      }
    }
    
    // Store function in ref for safe access
    loadReceiverLocationsRef.current = loadReceiverLocations
    
    // Safe wrapper that checks upload state before calling
    // NOTE: Cannot use useCallback here - it's inside useEffect (violates Rules of Hooks)
    // Just use a regular function instead
    const safeLoadReceiverLocations = () => {
      if (uploadingPhotoRef.current) {
        console.error('[Photo] ⏸️ Deferring location reload - photo upload in progress')
        loadLocationsQueuedRef.current = true
        return
      }
      if (loadReceiverLocationsRef.current) {
        console.log('[DIAG] [Sender] 🔄 Calling loadReceiverLocations via safe wrapper', {
          timestamp: new Date().toISOString()
        })
        loadReceiverLocationsRef.current()
      } else {
        console.warn('[Sender] ⚠️ loadReceiverLocationsRef.current is null - cannot load locations', {
          timestamp: new Date().toISOString()
        })
      }
    }

    console.log('[DIAG] [Sender] 🚀 Calling loadReceiverLocations on initial load...', {
      alertId: alert.id,
      userId: user.id,
      timestamp: new Date().toISOString()
    })
    loadReceiverLocations()

    // Subscribe to alert_responses updates to detect when responders accept
    console.log('[DIAG] [Sender] 🔔 Setting up alert_responses subscription for acceptance detection:', {
      alertId: alert.id,
      timestamp: new Date().toISOString()
    })
    
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
          
          console.log('[DIAG] [Sender] ✅ Checkpoint 1.1 - Acceptance Detection:', {
            contactUserId: payload.new.contact_user_id,
            acknowledgedAt: payload.new.acknowledged_at,
            alertId: alert.id,
            oldAcknowledgedAt: payload.old?.acknowledged_at,
            timestamp: new Date().toISOString(),
            payloadNew: payload.new,
            payloadOld: payload.old
          })
          // When someone accepts, reload receiver locations and update count
          if (payload.new.acknowledged_at) {
            const contactUserId = payload.new.contact_user_id
            const acceptanceTimestamp = Date.now()
            
            // Phase 5: Check if this is a recent acceptance (within last 15 seconds)
            const recentAcceptanceTime = recentAcceptancesRef.current.get(contactUserId)
            const isRecentAcceptance = recentAcceptanceTime && (acceptanceTimestamp - recentAcceptanceTime) < 15000
            
            if (isRecentAcceptance) {
              console.log('[Sender] ⏭️ Phase 5 - Skipping duplicate acceptance handling (recently processed):', {
                contactUserId: contactUserId,
                previousTimestamp: new Date(recentAcceptanceTime).toISOString(),
                currentTimestamp: new Date(acceptanceTimestamp).toISOString(),
                elapsedSeconds: Math.round((acceptanceTimestamp - recentAcceptanceTime) / 1000)
              })
              return // Skip duplicate processing
            }
            
            // Phase 5: Track this acceptance
            recentAcceptancesRef.current.set(contactUserId, acceptanceTimestamp)
            
            // Phase 5: Clean up old acceptances (older than 15 seconds)
            const fifteenSecondsAgo = acceptanceTimestamp - 15000
            for (const [userId, timestamp] of recentAcceptancesRef.current.entries()) {
              if (timestamp < fifteenSecondsAgo) {
                recentAcceptancesRef.current.delete(userId)
              }
            }
            
            console.log('[Sender] ✅ Responder accepted - reloading locations:', {
              contactUserId: contactUserId,
              alertId: alert.id,
              timestamp: new Date(acceptanceTimestamp).toISOString(),
              recentAcceptancesCount: recentAcceptancesRef.current.size
            })
            
            // Clear any existing retry timeouts to prevent duplicates
            if (acceptanceRetryTimeout1Ref.current) {
              clearTimeout(acceptanceRetryTimeout1Ref.current)
              acceptanceRetryTimeout1Ref.current = null
            }
            if (acceptanceRetryTimeout2Ref.current) {
              clearTimeout(acceptanceRetryTimeout2Ref.current)
              acceptanceRetryTimeout2Ref.current = null
            }
            
            // Phase 2: Enable enhanced polling mode
            if (enhancedPollingTimeoutRef.current) {
              clearTimeout(enhancedPollingTimeoutRef.current)
              enhancedPollingTimeoutRef.current = null
            }
            enhancedPollingRef.current = true
            enhancedPollingStartTimeRef.current = Date.now()
            console.log('[Sender] 🚀 Phase 2 - Enhanced polling mode activated (1s interval for 10s)')
            
            // Phase 2: Disable enhanced polling after 10 seconds
            enhancedPollingTimeoutRef.current = setTimeout(() => {
              if (!isUnmountingRef.current) {
                enhancedPollingRef.current = false
                enhancedPollingStartTimeRef.current = null
                console.log('[Sender] 🔄 Phase 2 - Enhanced polling mode deactivated (returning to 3s interval)')
              }
            }, 10000)
            
            // Update count immediately
            setAcceptedResponderCount((prev) => prev + 1)
            
            // Phase 1: Immediate load attempt
            const acceptanceTimestampISO = new Date(acceptanceTimestamp).toISOString()
            console.log('[Sender] 🔄 Phase 1 - Immediate load attempt for accepted responder:', {
              contactUserId: contactUserId,
              timestamp: acceptanceTimestampISO,
              attempt: 'immediate'
            })
            safeLoadReceiverLocations()
            
            // CRITICAL FIX: Add immediate retry after 1 second (gives time for location to be saved via API)
            setTimeout(() => {
              console.log('[Sender] 🔄 Immediate retry after acceptance (1s delay - waiting for location save via API)', {
                contactUserId: contactUserId,
                alertId: alert.id,
                timestamp: new Date().toISOString()
              })
              safeLoadReceiverLocations()
            }, 1000)
            
            // Phase 1: Delayed retry after 2 seconds (gives time for location save)
            acceptanceRetryTimeout1Ref.current = setTimeout(() => {
              if (!isUnmountingRef.current) {
                // Phase 5: Verify this acceptance is still recent before retrying
                const currentAcceptanceTime = recentAcceptancesRef.current.get(contactUserId)
                if (!currentAcceptanceTime || (Date.now() - currentAcceptanceTime) > 15000) {
                  console.log('[Sender] ⏭️ Phase 5 - Skipping retry 1 (acceptance no longer recent):', contactUserId)
                  return
                }
                
                const retryTimestamp = new Date().toISOString()
                const elapsed = Math.round((Date.now() - acceptanceTimestamp) / 1000)
                console.log('[Sender] 🔄 Phase 1 - Retry attempt 1 (2s delay) for accepted responder:', {
                  contactUserId: contactUserId,
                  timestamp: retryTimestamp,
                  elapsedSeconds: elapsed,
                  attempt: 'retry-1'
                })
                safeLoadReceiverLocations()
              }
            }, 2000)
            
            // Phase 1: Final retry after 5 seconds (handles network delays)
            acceptanceRetryTimeout2Ref.current = setTimeout(() => {
              if (!isUnmountingRef.current) {
                // Phase 5: Verify this acceptance is still recent before retrying
                const currentAcceptanceTime = recentAcceptancesRef.current.get(contactUserId)
                if (!currentAcceptanceTime || (Date.now() - currentAcceptanceTime) > 15000) {
                  console.log('[Sender] ⏭️ Phase 5 - Skipping retry 2 (acceptance no longer recent):', contactUserId)
                  return
                }
                
                const retryTimestamp = new Date().toISOString()
                const elapsed = Math.round((Date.now() - acceptanceTimestamp) / 1000)
                console.log('[Sender] 🔄 Phase 1 - Retry attempt 2 (5s delay) for accepted responder:', {
                  contactUserId: contactUserId,
                  timestamp: retryTimestamp,
                  elapsedSeconds: elapsed,
                  attempt: 'retry-2'
                })
                safeLoadReceiverLocations()
              }
            }, 5000)
          }
        }
      )
      .subscribe((status: any, err?: any) => {
        console.log('[DIAG] [Sender] 🔔 alert_responses subscription status:', {
          status,
          alertId: alert.id,
          error: err,
          timestamp: new Date().toISOString()
        })
        
        if (status === 'SUBSCRIBED') {
          console.log('[DIAG] [Sender] ✅ Successfully subscribed to alert_responses for acceptance detection:', {
            alertId: alert.id,
            timestamp: new Date().toISOString()
          })
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
          console.error('[DIAG] [Sender] ❌ alert_responses subscription failed:', {
            status,
            error: err,
            alertId: alert.id,
            note: 'Using polling fallback',
            timestamp: new Date().toISOString()
          })
          // Immediately trigger polling fallback when subscription fails
          safeLoadReceiverLocations()
        } else {
          console.log('[DIAG] [Sender] ⚠️ alert_responses subscription status (non-critical):', {
            status,
            alertId: alert.id,
            timestamp: new Date().toISOString()
          })
          // If subscription closes for any reason, trigger polling
          if (status === 'CLOSED') {
            console.warn('[DIAG] [Sender] ⚠️ Subscription closed - triggering immediate polling check:', {
              alertId: alert.id,
              timestamp: new Date().toISOString()
            })
            loadReceiverLocations()
          }
        }
      })
    
    // COMPREHENSIVE FIX: Exponential backoff polling with direct Supabase queries
    // Polls at: 1s, 2s, 4s, 8s, then 10s (max) - resets to 1s when change detected
    // NOTE: pollingAttemptRef is defined at component top level (Rules of Hooks)
    const basePollInterval = 1000 // Start with 1 second
    const maxPollInterval = 10000 // Max 10 seconds
    
    const scheduleNextPoll = () => {
      if (isUnmountingRef.current) return
      
      // Calculate exponential backoff interval
      const pollInterval = Math.min(
        basePollInterval * Math.pow(2, Math.min(pollingAttemptRef.current, 3)), // 1s, 2s, 4s, 8s
        maxPollInterval // Cap at 10s
      )
      
      // Reset attempt counter after max interval (we're in steady state)
      if (pollInterval >= maxPollInterval) {
        pollingAttemptRef.current = 0
      }
      
      console.log('[DIAG] [Sender] 🔄 COMPREHENSIVE FIX - Scheduling next poll:', {
        attempt: pollingAttemptRef.current + 1,
        pollInterval: `${pollInterval}ms`,
        timestamp: new Date().toISOString()
      })
      
      acceptancePollTimeoutRef.current = setTimeout(async () => {
        if (isUnmountingRef.current) {
          acceptancePollTimeoutRef.current = null
          return
        }
        
        if (!alert || !user) {
          scheduleNextPoll()
          return
        }
        
        pollingAttemptRef.current++
        
        console.log('[DIAG] [Sender] 🔍 COMPREHENSIVE FIX - Polling for receiver locations (direct Supabase query):', {
          attempt: pollingAttemptRef.current,
          timestamp: new Date().toISOString()
        })
        
        try {
          // COMPREHENSIVE FIX: Direct Supabase query (no API calls)
          const supabase = createClient()
          const { data: currentResponses, error: pollError } = await supabase
            .from('alert_responses')
            .select('contact_user_id')
            .eq('alert_id', alert.id)
            .not('acknowledged_at', 'is', null)
            .is('declined_at', null)
          
          if (pollError) {
            console.warn('[DIAG] [Sender] ⚠️ COMPREHENSIVE FIX - Polling query error:', {
              error: pollError,
              attempt: pollingAttemptRef.current,
              timestamp: new Date().toISOString()
            })
            scheduleNextPoll()
            return
          }
          
          const currentCount = currentResponses?.length || 0
          const currentUserIds = currentResponses?.map((r: any) => r.contact_user_id) || []
          
          if (currentCount !== acceptedResponderCount) {
            if (isUnmountingRef.current) {
              acceptancePollTimeoutRef.current = null
              return
            }
            
            console.log('[DIAG] [Sender] ✅ COMPREHENSIVE FIX - Polling detected acceptance change:', {
              previousCount: acceptedResponderCount,
              currentCount: currentCount,
              change: currentCount - acceptedResponderCount,
              currentUserIds: currentUserIds,
              timestamp: new Date().toISOString()
            })
            
            // Reset polling attempt (we found a change, go back to fast polling)
            pollingAttemptRef.current = 0
            
            // Update count
            setAcceptedResponderCount(currentCount)
            
            // Find newly accepted user
            const newlyAcceptedUserId = currentUserIds.find((id: string) => 
              !receiverUserIds.includes(id)
            )
            
            if (newlyAcceptedUserId) {
              const acceptanceTimestamp = Date.now()
              console.log('[DIAG] [Sender] ✅ COMPREHENSIVE FIX - Polling detected NEW acceptance:', {
                newlyAcceptedUserId,
                alertId: alert.id,
                timestamp: new Date().toISOString()
              })
              
              // Track this acceptance
              recentAcceptancesRef.current.set(newlyAcceptedUserId, acceptanceTimestamp)
            }
            
            // Trigger full reload
            safeLoadReceiverLocations()
          } else if (currentCount > 0 && receiverLocations.size === 0) {
            // We have accepted responders but no locations - reload
            console.log('[DIAG] [Sender] ⚠️ COMPREHENSIVE FIX - Polling detected missing locations:', {
              acceptedCount: currentCount,
              locationsCount: receiverLocations.size,
              timestamp: new Date().toISOString()
            })
            
            // Reset polling attempt
            pollingAttemptRef.current = 0
            
            // Trigger reload
            safeLoadReceiverLocations()
          }
          
          // Continue polling
          scheduleNextPoll()
        } catch (pollErr) {
          console.warn('[DIAG] [Sender] ⚠️ COMPREHENSIVE FIX - Polling error:', {
            error: pollErr,
            attempt: pollingAttemptRef.current,
            timestamp: new Date().toISOString()
          })
          // Continue polling despite error (with backoff)
          scheduleNextPoll()
        }
      }, pollInterval)
    }
    
    // Start polling
    scheduleNextPoll()

    // Subscribe to receiver location updates (only from accepted responders)
    // FINAL FIX: Make Realtime subscription the primary source
    // Trust that if a location appears in location_history, the user has accepted
    // (The API endpoint already checks acceptance before saving)
    const unsubscribeReceiverLocations = subscribeToLocationHistory(alert.id, async (newLocation) => {
      if (isUnmountingRef.current) return // Don't update state if unmounting
      
      console.log('[Sender] 📍 Location update received from Realtime subscription:', {
        userId: newLocation.user_id,
        senderUserId: user.id,
        isSender: newLocation.user_id === user.id,
        locationId: newLocation.id,
        location: { lat: newLocation.latitude, lng: newLocation.longitude }
      })
      
      // Only process receiver locations (not sender's own location)
      if (newLocation.user_id !== user.id) {
        // Trust the subscription - if location is in location_history, user has accepted
        // (The save-receiver-location API endpoint already verifies acceptance)
        console.log('[Sender] ✅ Adding receiver location from subscription (trusting acceptance):', {
          receiverId: newLocation.user_id,
          location: { lat: newLocation.latitude, lng: newLocation.longitude },
          timestamp: newLocation.created_at,
          locationId: newLocation.id
        })
        
        setReceiverLocations((prev) => {
          // Create a new Map instance to ensure React detects the change
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
          
          // Get existing locations and add new one
          const receiverHistory = updated.get(receiverId) || []
          
          // Check if this location already exists (avoid duplicates)
          const exists = receiverHistory.some(loc => loc.id === newLocation.id)
          if (!exists) {
            // Add new location and sort by created_at (ascending - oldest first, newest last)
            const updatedHistory = [...receiverHistory, newLocation].sort((a, b) => {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            })
            updated.set(receiverId, updatedHistory)
            
            console.log('[Sender] ✅ Updated receiver locations from subscription:', {
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
            console.log('[Sender] ⚠️ Location already exists, skipping:', {
              receiverId,
              locationId: newLocation.id
            })
          }
          
          return updated
        })
      } else {
        console.log('[Sender] ⏭️ Ignoring own location update')
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
      
      // Phase 2: Cleanup polling (using recursive setTimeout pattern)
      if (acceptancePollTimeoutRef.current) {
        clearTimeout(acceptancePollTimeoutRef.current)
        acceptancePollTimeoutRef.current = null
      }
      
      // Phase 2: Cleanup enhanced polling timeout
      if (enhancedPollingTimeoutRef.current) {
        clearTimeout(enhancedPollingTimeoutRef.current)
        enhancedPollingTimeoutRef.current = null
      }
      enhancedPollingRef.current = false
      enhancedPollingStartTimeRef.current = null
      console.log('[Sender] 🧹 Phase 2 - Cleaned up enhanced polling')
      
      // Phase 1: Cleanup retry timeouts
      if (acceptanceRetryTimeout1Ref.current) {
        clearTimeout(acceptanceRetryTimeout1Ref.current)
        acceptanceRetryTimeout1Ref.current = null
      }
      if (acceptanceRetryTimeout2Ref.current) {
        clearTimeout(acceptanceRetryTimeout2Ref.current)
        acceptanceRetryTimeout2Ref.current = null
      }
      console.log('[Sender] 🧹 Phase 1 - Cleaned up retry timeouts')
      
      // Phase 5: Cleanup recent acceptances tracking
      recentAcceptancesRef.current.clear()
      console.log('[Sender] 🧹 Phase 5 - Cleaned up recent acceptances tracking')
      
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
    console.log('[Photo] 🎯 handleCapturePhoto called', {
      hasAlert: !!alert,
      hasUser: !!user,
      alertId: alert?.id,
      userId: user?.id,
      uploadingPhoto,
      uploadingPhotoRefCurrent: uploadingPhotoRef.current
    })
    
    if (!alert || !user || uploadingPhoto || uploadingPhotoRef.current) {
      console.warn('[Photo] ⚠️ Cannot capture photo - conditions not met:', {
        hasAlert: !!alert,
        hasUser: !!user,
        uploadingPhoto,
        uploadingPhotoRefCurrent: uploadingPhotoRef.current
      })
      return
    }

    try {
      console.log('[Photo] 📸 Button clicked - starting capture')
      uploadingPhotoRef.current = true
      setUploadingPhoto(true)
      
      console.log('[Photo] 🔄 Calling capturePhoto()...')
      const file = await capturePhoto()
      console.log('[Photo] 📁 File captured result:', file ? { 
        name: file.name, 
        size: file.size, 
        type: file.type 
      } : 'null')
      
      if (!file) {
        console.log('[Photo] ⚠️ No file selected - user cancelled or error occurred')
        uploadingPhotoRef.current = false
        setUploadingPhoto(false)
        return
      }

      console.log('[Photo] 🚀 Starting upload process...', {
        alertId: alert.id,
        userId: user.id,
        fileName: file.name,
        fileSize: file.size
      })
      const photo = await uploadEmergencyPhoto(alert.id, user.id, file)
      
      if (photo) {
        console.log('[Photo] ✅ Photo uploaded successfully:', {
          photoId: photo.id,
          alertId: alert.id,
          storagePath: photo.storage_path
        })
        // Photo will be added via Realtime subscription
      } else {
        console.error('[Photo] ❌ Upload returned null - check console for error details above')
        // Error message already shown by uploadEmergencyPhoto
      }
    } catch (error: any) {
      console.error('[Photo] ❌ Error capturing photo:', {
        error: error?.message || error,
        stack: error?.stack,
        name: error?.name,
        alertId: alert?.id,
        userId: user?.id
      })
      window.alert(`Failed to capture photo: ${error?.message || 'Unknown error'}. Please try again.`)
    } finally {
      console.log('[Photo] 🏁 handleCapturePhoto finally block - cleaning up')
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
              {location ? (
                <GoogleMapComponent
                  latitude={location.lat}
                  longitude={location.lng}
                  alertId={alert.id}
                  user_id={alert.user_id}
                  receiverLocations={receiverLocations}
                  receiverUserIds={receiverUserIds}
                  senderUserId={user.id}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-200">
                  <div className="text-center p-4">
                    <p className="text-gray-600 font-medium mb-2">Loading location...</p>
                    <p className="text-gray-500 text-sm">Waiting for GPS coordinates</p>
                  </div>
                </div>
              )}
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

