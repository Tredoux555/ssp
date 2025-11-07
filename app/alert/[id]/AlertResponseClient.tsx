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
import { AlertTriangle, MapPin, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import LocationPermissionPrompt from '@/components/LocationPermissionPrompt'
import { useLocationPermission } from '@/lib/hooks/useLocationPermission'

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
  const [accepting, setAccepting] = useState(false)
  const subscriptionsSetupRef = useRef<string | null>(null) // Track which alert ID subscriptions are set up for
  const loadAlertCalledRef = useRef<string | null>(null) // Track if loadAlert has been called for this alertId

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
      
      // Check if user has already accepted to respond
      const { data: alertResponse, error: responseError } = await supabase
        .from('alert_responses')
        .select('acknowledged_at')
        .eq('alert_id', alertId)
        .eq('contact_user_id', user.id)
        .maybeSingle()
      
      if (alertResponse && alertResponse.acknowledged_at) {
        setHasAccepted(true)
      } else {
        setHasAccepted(false)
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

  const handleAcceptResponse = useCallback(async () => {
    if (!user || !alert || accepting) return

    setAccepting(true)
    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('alert_responses')
        .update({ acknowledged_at: new Date().toISOString() })
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
    } catch (error: any) {
      console.error('[Alert] Error accepting response:', error)
      window.alert('An error occurred. Please try again.')
      setAccepting(false)
    }
  }, [user, alert, accepting])

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
    getCurrentLocation()
      .then((loc) => {
        if (loc) {
          setReceiverLocation(loc)
          setReceiverLastUpdate(new Date())
          console.log('[Receiver] Got current location for directions:', loc)
        }
      })
      .catch((error) => {
        console.warn('[Receiver] Could not get current location for directions:', error)
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
      console.log('[Receiver] Location update received via subscription:', {
        userId: newLocation.user_id,
        alertUserId: alert.user_id,
        receiverUserId: user.id,
        isSender: newLocation.user_id === alert.user_id,
        isReceiver: newLocation.user_id === user.id,
        location: { lat: newLocation.latitude, lng: newLocation.longitude }
      })
      
      // Check if this is sender's location or receiver's location
      if (newLocation.user_id === alert.user_id) {
        // This is sender's location
        console.log('[Receiver] Updating sender location from subscription')
        setLocationHistory((prev) => [...prev, newLocation])
        setLocation(newLocation)
      } else if (newLocation.user_id === user.id) {
        // This is receiver's location
        console.log('[Receiver] Updating own location from subscription')
        setReceiverLocationHistory((prev) => [...prev, newLocation])
        setReceiverLocation({
          lat: newLocation.latitude,
          lng: newLocation.longitude,
        })
        setReceiverLastUpdate(new Date())
      } else {
        console.warn('[Receiver] Received location update for unknown user:', newLocation.user_id)
      }
    })

    // Add polling fallback for location updates (in case subscription fails)
    // Poll every 10 seconds for sender's location updates
    const pollInterval = setInterval(async () => {
      if (!alert || !user) return
      
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
          const updatedAlert = payload.new as EmergencyAlert
          setAlert(updatedAlert)
          if (updatedAlert.status !== 'active') {
            hideEmergencyAlert()
            router.push('/dashboard')
          }
        }
      )
      .subscribe()


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
      hideEmergencyAlert()
    }
    // Only depend on alert.id and user.id, not the full alert object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id, user?.id, router, permissionStatus, hasAccepted])

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
          <Button onClick={() => router.push('/dashboard')} variant="secondary" size="sm">
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

          {!hasAccepted && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-gray-700 mb-3">
                Accept to start sharing your location and help respond to this emergency.
              </p>
              <Button
                onClick={handleAcceptResponse}
                disabled={accepting}
                variant="primary"
                size="lg"
                className="w-full"
              >
                {accepting ? 'Accepting...' : 'Accept to Respond'}
              </Button>
            </div>
          )}

          {hasAccepted && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-700 font-medium">
                ✓ You're responding - Your location is being shared
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

        {location && user && (
          <div className="mb-6" style={{ height: '400px', width: '100%' }}>
            <GoogleMapComponent
              latitude={location.latitude}
              longitude={location.longitude}
              alertId={alert.id}
              user_id={alert.user_id}
              receiverLocation={receiverLocation}
              receiverLocationHistory={receiverLocationHistory}
              receiverUserId={user.id}
              senderUserId={alert.user_id}
            />
          </div>
        )}
      </Card>
    </div>
  )
}

