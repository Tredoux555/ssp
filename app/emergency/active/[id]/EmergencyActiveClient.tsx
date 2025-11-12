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
    console.log('[Sender] 🔄 useEffect for receiver locations triggered:', {
      hasAlert: !!alert,
      alertId: alert?.id,
      hasUser: !!user,
      userId: user?.id,
      urlAlertId: alertId
    })
    
    if (!alert || !user) {
      console.log('[Sender] ⏭️ Skipping receiver locations load - missing alert or user', {
        hasAlert: !!alert,
        hasUser: !!user
      })
      return
    }

    // Check location permission before starting tracking
    if (permissionStatus === 'denied' || permissionStatus === 'prompt') {
      setShowPermissionPrompt(true)
    } else if (permissionStatus === 'granted') {
      setShowPermissionPrompt(false)
    }

    // Query all receiver locations from location_history (only from accepted responders)
    // Uses server-side API endpoints to bypass RLS
    const loadReceiverLocations = async () => {
      const diagStartTime = Date.now()
      const timingCheckpoints: Record<string, number> = { start: diagStartTime }
      
      console.log('[DIAG] [Sender] 🔄 Checkpoint 8 - Timing Analysis: loadReceiverLocations started', {
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
      
      console.log('[Sender] ✅ Starting to fetch receiver locations from API...', {
        alertId: alert.id,
        url: `/api/emergency/${alert.id}/accepted-responders`
      })
      
      // Helper function to add timeout to fetch calls
      const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 10000): Promise<Response> => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          controller.abort()
        }, timeoutMs)
        
        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          })
          clearTimeout(timeoutId)
          return response
        } catch (error: any) {
          clearTimeout(timeoutId)
          if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`)
          }
          throw error
        }
      }
      
      try {
        const fetchStartTime = Date.now()
        timingCheckpoints.acceptedRespondersStart = fetchStartTime
        console.log('[DIAG] [Sender] 🌐 Checkpoint 1.2 - API Call: accepted-responders', {
          url: `/api/emergency/${alert.id}/accepted-responders`,
          timeout: '10s',
          timestamp: new Date().toISOString(),
          alertId: alert.id,
          userId: user.id,
          timeSinceStart: `${fetchStartTime - diagStartTime}ms`
        })
        
        // Use API endpoint to get accepted responders (bypasses RLS)
        // Use no-store to prevent caching - we need real-time data
        // Add 10 second timeout to prevent indefinite hanging
        const acceptedResponse = await fetchWithTimeout(
          `/api/emergency/${alert.id}/accepted-responders`,
          {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache'
            }
          },
          10000 // 10 second timeout
        )
        
        const fetchEndTime = Date.now()
        const fetchDuration = fetchEndTime - fetchStartTime
        timingCheckpoints.acceptedRespondersEnd = fetchEndTime
        timingCheckpoints.acceptedRespondersDuration = fetchDuration
        
        console.log('[DIAG] [Sender] ✅ Checkpoint 1.2 - API Response: accepted-responders', {
          status: acceptedResponse.status,
          statusText: acceptedResponse.statusText,
          ok: acceptedResponse.ok,
          duration: `${fetchDuration}ms`,
          url: `/api/emergency/${alert.id}/accepted-responders`,
          timestamp: new Date().toISOString(),
          timeSinceStart: `${fetchEndTime - diagStartTime}ms`
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
              urlAlertId: alertId,
              alertExists: !!alert,
              alertStatus: alert?.status,
              alertUserId: alert?.user_id,
              currentUserId: user?.id,
              alertIdMatch: alert?.id === alertId
            })
            
            // If alert exists locally but API can't find it, try reloading alert
            // This handles timing issues where alert was just created
            if (alert && alert.id && alert.id === alertId) {
              console.log('[Sender] 🔄 Alert exists locally but not in API - reloading alert in 1 second...')
              setTimeout(() => {
                if (!isUnmountingRef.current && alert && alert.id === alertId) {
                  loadAlert()
                }
              }, 1000)
            }
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

        console.log('[DIAG] [Sender] 📊 Checkpoint 1.2 - API Data Parsed: accepted-responders', {
          rawResponse: acceptedData,
          acceptedResponses: acceptedResponses,
          acceptedCount: acceptedCount,
          acceptedUserIds: acceptedResponses.map((r: { contact_user_id: string }) => r.contact_user_id),
          timestamp: new Date().toISOString()
        })

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

        const acceptedUserIds = acceptedResponses.map((r: { contact_user_id: string }) => r.contact_user_id)
        console.log('[DIAG] [Sender] ✅ Found accepted responders via API:', {
          count: acceptedCount,
          userIds: acceptedUserIds,
          timestamp: new Date().toISOString()
        })

        // Use API endpoint to get receiver locations (bypasses RLS)
        // Use no-store to prevent caching - we need real-time data
        const locationsFetchStartTime = Date.now()
        timingCheckpoints.receiverLocationsStart = locationsFetchStartTime
        console.log('[DIAG] [Sender] 🌐 Checkpoint 1.2 - API Call: receiver-locations', {
          url: `/api/emergency/${alert.id}/receiver-locations`,
          timeout: '10s',
          timestamp: new Date().toISOString(),
          alertId: alert.id,
          acceptedUserIds: acceptedUserIds,
          timeSinceStart: `${locationsFetchStartTime - diagStartTime}ms`,
          timeSinceAcceptedResponders: `${locationsFetchStartTime - fetchEndTime}ms`
        })
        
        const locationsResponse = await fetchWithTimeout(
          `/api/emergency/${alert.id}/receiver-locations`,
          {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache'
            }
          },
          10000 // 10 second timeout
        )
        
        const locationsFetchEndTime = Date.now()
        const locationsFetchDuration = locationsFetchEndTime - locationsFetchStartTime
        timingCheckpoints.receiverLocationsEnd = locationsFetchEndTime
        timingCheckpoints.receiverLocationsDuration = locationsFetchDuration
        
        console.log('[DIAG] [Sender] ✅ Checkpoint 1.2 - API Response: receiver-locations', {
          status: locationsResponse.status,
          statusText: locationsResponse.statusText,
          ok: locationsResponse.ok,
          duration: `${locationsFetchDuration}ms`,
          url: `/api/emergency/${alert.id}/receiver-locations`,
          timestamp: new Date().toISOString(),
          timeSinceStart: `${locationsFetchEndTime - diagStartTime}ms`
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

        // Phase 9: Data validation
        const validationErrors: string[] = []
        if (!Array.isArray(allLocations)) {
          validationErrors.push('receiverLocations is not an array')
        }
        if (typeof groupedByUser !== 'object' || groupedByUser === null) {
          validationErrors.push('groupedByUser is not an object')
        }
        if (acceptedUserIds.length > 0 && allLocations.length === 0) {
          validationErrors.push('WARNING: Accepted responders exist but no locations found')
        }

        console.log('[DIAG] [Sender] 📍 Checkpoint 1.2 - API Data Parsed: receiver-locations', {
          rawResponse: locationsData,
          totalLocations: allLocations.length,
          groupedByUserKeys: Object.keys(groupedByUser),
          groupedByUserSize: Object.keys(groupedByUser).length,
          acceptedUserIds: acceptedUserIds,
          locationsDataKeys: Object.keys(locationsData),
          groupedByUserStructure: Object.entries(groupedByUser).map(([id, locs]: [string, any]) => ({
            receiverId: id,
            locationCount: Array.isArray(locs) ? locs.length : 0,
            isArray: Array.isArray(locs),
            latestLocation: Array.isArray(locs) && locs.length > 0 ? {
              lat: locs[0].latitude,
              lng: locs[0].longitude,
              id: locs[0].id,
              timestamp: locs[0].created_at
            } : null
          })),
          timestamp: new Date().toISOString()
        })
        
        // Phase 9: Log validation results
        if (validationErrors.length > 0) {
          console.warn('[DIAG] [Sender] ⚠️ Checkpoint 9 - Data Validation: Errors found', {
            errors: validationErrors,
            timestamp: new Date().toISOString()
          })
        } else {
          console.log('[DIAG] [Sender] ✅ Checkpoint 9 - Data Validation: Passed', {
            timestamp: new Date().toISOString()
          })
        }

        if (allLocations && allLocations.length > 0) {
          console.log('[Sender] ✅ Loaded receiver locations via API:', {
            count: allLocations.length,
            uniqueReceivers: Object.keys(groupedByUser).length,
            receiverIds: Object.keys(groupedByUser),
            locationsPerReceiver: Object.entries(groupedByUser).map(([id, locs]: [string, any]) => ({
              receiverId: id,
              locationCount: Array.isArray(locs) ? locs.length : 0,
              latestLocation: Array.isArray(locs) && locs.length > 0 ? {
                lat: locs[0].latitude,
                lng: locs[0].longitude,
                timestamp: locs[0].created_at
              } : null
            }))
          })
          
          // Convert groupedByUser object to Map
          const receiverMap = new Map<string, LocationHistory[]>()
          const userIds = new Set<string>()

          Object.entries(groupedByUser).forEach(([receiverId, locations]: [string, any]) => {
            // Ensure locations is an array
            const locationArray = Array.isArray(locations) ? locations : []
            
            // Sort by created_at descending (newest first) to ensure latest is at the end
            const sortedLocations = [...locationArray].sort((a: LocationHistory, b: LocationHistory) => {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            })
            
            userIds.add(receiverId)
            receiverMap.set(receiverId, sortedLocations as LocationHistory[])
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

          const previousStateSize = receiverLocations.size
          const previousStateKeys = Array.from(receiverLocations.keys())
          
          console.log('[DIAG] [Sender] 📍 Checkpoint 1.3 - Before State Update:', {
            previousStateSize: previousStateSize,
            previousStateKeys: previousStateKeys,
            newStateSize: receiverMap.size,
            newStateKeys: Array.from(receiverMap.keys()),
            timestamp: new Date().toISOString()
          })
          
          console.log('[DIAG] [Sender] 📍 Checkpoint 1.3 - Setting receiver locations state:', {
            mapSize: receiverMap.size,
            userIds: Array.from(userIds),
            receiverIds: Array.from(receiverMap.keys()),
            totalLocations: Array.from(receiverMap.values()).reduce((sum, locs) => sum + locs.length, 0),
            timestamp: new Date().toISOString(),
            stateChange: previousStateSize !== receiverMap.size ? 'SIZE_CHANGED' : 'SAME_SIZE',
            newReceivers: Array.from(receiverMap.keys()).filter(id => !previousStateKeys.includes(id))
          })
          
          // Phase 3: Log successful location load (helps track which retry succeeded)
          const stateUpdateTime = Date.now()
          timingCheckpoints.stateUpdate = stateUpdateTime
          timingCheckpoints.totalDuration = stateUpdateTime - diagStartTime
          
          if (receiverMap.size > 0) {
            console.log('[DIAG] [Sender] ✅ Checkpoint 1.3 - Successfully loaded receiver locations:', {
              receiverCount: receiverMap.size,
              receiverIds: Array.from(userIds),
              totalLocations: Array.from(receiverMap.values()).reduce((sum, locs) => sum + locs.length, 0),
              timestamp: new Date().toISOString(),
              elapsedTime: `${stateUpdateTime - diagStartTime}ms`
            })
            
            // Phase 8: Comprehensive timing analysis
            console.log('[DIAG] [Sender] ⏱️ Checkpoint 8 - Timing Analysis Summary:', {
              totalDuration: `${timingCheckpoints.totalDuration}ms`,
              acceptedRespondersDuration: `${timingCheckpoints.acceptedRespondersDuration}ms`,
              receiverLocationsDuration: `${timingCheckpoints.receiverLocationsDuration}ms`,
              timeBetweenCalls: `${timingCheckpoints.receiverLocationsStart - timingCheckpoints.acceptedRespondersEnd}ms`,
              checkpoints: {
                start: timingCheckpoints.start,
                acceptedRespondersStart: timingCheckpoints.acceptedRespondersStart,
                acceptedRespondersEnd: timingCheckpoints.acceptedRespondersEnd,
                receiverLocationsStart: timingCheckpoints.receiverLocationsStart,
                receiverLocationsEnd: timingCheckpoints.receiverLocationsEnd,
                stateUpdate: timingCheckpoints.stateUpdate
              },
              timestamp: new Date().toISOString()
            })
          }

          setReceiverLocations(receiverMap)
          setReceiverUserIds(Array.from(userIds))
          
          // Log after state update (React will update asynchronously, but we log the intent)
          console.log('[DIAG] [Sender] ✅ Checkpoint 1.3 - State Update Called:', {
            stateUpdateFunction: 'setReceiverLocations',
            newMapSize: receiverMap.size,
            newUserIds: Array.from(userIds),
            timestamp: new Date().toISOString()
          })
        } else {
          console.warn('[Sender] ⚠️ No receiver locations found yet (accepted responders exist but no locations saved):', {
            acceptedUserIds: acceptedUserIds,
            alertId: alert.id,
            acceptedCount: acceptedCount,
            locationsResponseStatus: locationsResponse.status,
            locationsData: locationsData
          })
          // Keep accepted count but clear locations
          setReceiverLocations(new Map())
          setReceiverUserIds([])
        }
      } catch (error: any) {
        const isTimeout = error?.message?.includes('timeout') || error?.message?.includes('Timeout')
        const isAbort = error?.name === 'AbortError'
        const isNetworkError = error instanceof TypeError && error.message?.includes('fetch')
        
        console.error('[Sender] ❌ Phase 3 - Error loading receiver locations via API:', {
          error: error,
          message: error?.message,
          name: error?.name,
          stack: error?.stack,
          alertId: alert.id,
          userId: user.id,
          errorType: error instanceof TypeError ? 'NetworkError' : error instanceof Error ? 'Error' : 'Unknown',
          isTimeout: isTimeout,
          isAbort: isAbort,
          isNetworkError: isNetworkError,
          timestamp: new Date().toISOString(),
          recoverySuggestion: isTimeout || isAbort 
            ? 'Will retry automatically via delayed retries and enhanced polling'
            : isNetworkError
            ? 'Network issue - will retry on next poll'
            : 'Check API endpoint and authentication'
        })
        
        // Phase 3: Enhanced error handling - distinguish timeout vs permanent errors
        if (isTimeout || isAbort) {
          console.warn('[Sender] ⚠️ Phase 3 - Request timed out - will retry on next poll/subscription update or delayed retry')
          // Don't clear state - keep existing data and retry later
        } else if (isNetworkError) {
          console.warn('[Sender] ⚠️ Phase 3 - Network error - will retry automatically')
          // CRITICAL FIX: Retry network errors immediately with exponential backoff
          const retryDelay = Math.min(1000 * Math.pow(2, 0), 5000) // Start with 1s, max 5s
          setTimeout(() => {
            if (!isUnmountingRef.current && loadReceiverLocationsRef.current) {
              console.log('[Sender] 🔄 Retrying location load after network error...')
              loadReceiverLocationsRef.current()
            }
          }, retryDelay)
          // Don't clear state - network issues are temporary
        } else {
          // For permanent errors (404, 401, 500), clear state
          console.warn('[Sender] ⚠️ Phase 3 - Permanent error detected - clearing receiver locations state')
          setReceiverLocations(new Map())
          setReceiverUserIds([])
        }
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
        console.log('[Sender] 🔄 Calling loadReceiverLocations via safe wrapper')
        loadReceiverLocationsRef.current()
      } else {
        console.warn('[Sender] ⚠️ loadReceiverLocationsRef.current is null - cannot load locations')
      }
    }

    console.log('[Sender] 🚀 Calling loadReceiverLocations on initial load...')
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
    
    // Phase 2: Add polling fallback with enhanced mode support
    // Uses recursive setTimeout to allow dynamic interval adjustment
    // Poll every 1 second when enhanced mode active, 3 seconds otherwise
    // Uses API endpoint to bypass RLS
    const scheduleNextPoll = () => {
      if (isUnmountingRef.current) return // Don't schedule if unmounting
      
      // Phase 2: Determine polling interval based on enhanced mode
      const pollInterval = enhancedPollingRef.current ? 1000 : 3000
      const mode = enhancedPollingRef.current ? 'enhanced (1s)' : 'normal (3s)'
      
      if (process.env.NODE_ENV === 'development' && enhancedPollingRef.current) {
        const elapsed = enhancedPollingStartTimeRef.current 
          ? Math.round((Date.now() - enhancedPollingStartTimeRef.current) / 1000)
          : 0
        console.log(`[Sender] 🔄 Phase 2 - Polling in ${mode} mode (${elapsed}s elapsed)`)
      }
      
      acceptancePollTimeoutRef.current = setTimeout(async () => {
        if (!alert || !user || isUnmountingRef.current) {
          acceptancePollTimeoutRef.current = null
          return
        }
        
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
            scheduleNextPoll() // Continue polling despite error
            return
          }
          
          const data = await response.json()
          const currentCount = data.count || 0
          
          if (currentCount !== acceptedResponderCount) {
            if (isUnmountingRef.current) {
              acceptancePollTimeoutRef.current = null
              return
            }
            
            console.log('[DIAG] [Sender] ✅ Polling detected acceptance change via API:', {
              oldCount: acceptedResponderCount,
              newCount: currentCount,
              acceptedUserIds: data.acceptedResponders?.map((r: { contact_user_id: string }) => r.contact_user_id),
              alertId: alert.id,
              pollingMode: mode,
              timestamp: new Date().toISOString()
            })
            setAcceptedResponderCount(currentCount)
            
            // Trigger the same acceptance handling as subscription would
            const acceptedUserIds = data.acceptedResponders?.map((r: { contact_user_id: string }) => r.contact_user_id) || []
            if (acceptedUserIds.length > 0) {
              // Find the newly accepted user (one that wasn't in previous count)
              const newlyAcceptedUserId = acceptedUserIds.find((id: string) => 
                !receiverUserIds.includes(id)
              )
              
              if (newlyAcceptedUserId) {
                const acceptanceTimestamp = Date.now()
                console.log('[DIAG] [Sender] ✅ Polling detected NEW acceptance - triggering location reload:', {
                  newlyAcceptedUserId,
                  alertId: alert.id,
                  timestamp: new Date().toISOString()
                })
                
                // Track this acceptance
                recentAcceptancesRef.current.set(newlyAcceptedUserId, acceptanceTimestamp)
                
                // Enable enhanced polling
                enhancedPollingRef.current = true
                enhancedPollingStartTimeRef.current = Date.now()
                
                // Immediate load + retries
                safeLoadReceiverLocations()
                setTimeout(() => safeLoadReceiverLocations(), 1000)
              }
            }
            
            // Immediately reload receiver locations when acceptance is detected (safely)
            safeLoadReceiverLocations()
          } else if (currentCount > 0) {
            if (isUnmountingRef.current) {
              acceptancePollTimeoutRef.current = null
              return
            }
            
            // Even if count hasn't changed, periodically reload locations to get latest updates
            // This ensures we get location updates even if subscription is working
            if (process.env.NODE_ENV === 'development') {
              console.log('[Sender] 🔄 Periodic location refresh via API (polling fallback):', {
                acceptedCount: currentCount,
                alertId: alert.id,
                pollingMode: mode
              })
            }
            safeLoadReceiverLocations()
          }
          
          // Schedule next poll
          scheduleNextPoll()
        } catch (pollErr) {
          // Silently handle polling errors - non-critical
          if (process.env.NODE_ENV === 'development') {
            console.warn('[Sender] Polling error (non-critical):', pollErr)
          }
          // Continue polling despite error
          scheduleNextPoll()
        }
      }, pollInterval)
    }
    
    // Start polling
    scheduleNextPoll()

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
                  
                  console.log('[Sender] ✅ Updated receiver locations:', {
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

