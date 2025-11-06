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

      // DON'T show overlay on alert page - the page itself is the alert view
      // Hide any existing overlay when viewing alert page
      hideEmergencyAlert()
      
      // Fetch sender information
      const fetchSenderInfo = async () => {
        if (!alertData.user_id || !user) return
        
        try {
          const supabase = createClient()
          
          // Try from emergency_contacts first
          const { data: senderContact } = await supabase
            .from('emergency_contacts')
            .select('name, email')
            .eq('contact_user_id', alertData.user_id)
            .eq('user_id', user.id)
            .maybeSingle()
          
          if (senderContact) {
            setSenderName(senderContact.name || null)
            setSenderEmail(senderContact.email || null)
          } else {
            // Fallback to user_profiles
            const { data: senderProfile } = await supabase
              .from('user_profiles')
              .select('full_name, email')
              .eq('id', alertData.user_id)
              .maybeSingle()
            
            if (senderProfile) {
              setSenderName(senderProfile.full_name || null)
              setSenderEmail(senderProfile.email || null)
            }
          }
        } catch (err) {
          console.warn('[Alert] Could not fetch sender info:', err)
        }
      }
      
      fetchSenderInfo()

      // Play sound and vibrate (keep these for alert notification)
      playAlertSound()
      vibrateDevice()

      // Get initial location - prefer location_history over alert location
      // Add timeout to prevent hanging
      try {
        const locationPromise = supabase
          .from('location_history')
          .select('*')
          .eq('alert_id', alertId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        const timeoutPromise = new Promise<{ data: null; error: Error }>((_, reject) => 
          setTimeout(() => reject(new Error('Location query timeout')), 3000)
        )
        
        const result = await Promise.race([locationPromise, timeoutPromise]).catch(() => ({ data: null, error: null }))
        
        if (result && result.data) {
          setLocation(result.data)
        } else if (alertData.location_lat && alertData.location_lng) {
          // Fallback to alert location if no history yet
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
      } catch (locationErr) {
        console.warn('[Alert] Could not fetch initial location:', locationErr)
        // Fallback to alert location
        if (alertData.location_lat && alertData.location_lng) {
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

    // Start tracking receiver's own location
    const stopReceiverTracking = startLocationTracking(
      user.id,
      alert.id,
      async (loc) => {
        setReceiverLocation(loc)
        setReceiverLastUpdate(new Date())
        setReceiverTrackingActive(true)
      },
      10000 // Update every 10 seconds
    )
    
    setReceiverTrackingActive(true)
    
    // Get initial receiver location
    getCurrentLocation()
      .then((loc) => {
        if (loc) {
          setReceiverLocation(loc)
          setReceiverLastUpdate(new Date())
        }
      })
      .catch(() => {
        // Location unavailable - that's ok
      })

    // Subscribe to location updates (both sender and receiver)
    const unsubscribeLocation = subscribeToLocationHistory(alert.id, (newLocation) => {
      // Check if this is sender's location or receiver's location
      if (newLocation.user_id === alert.user_id) {
        // This is sender's location
        setLocationHistory((prev) => [...prev, newLocation])
        setLocation(newLocation)
      } else if (newLocation.user_id === user.id) {
        // This is receiver's location
        setReceiverLocationHistory((prev) => [...prev, newLocation])
        setReceiverLocation({
          lat: newLocation.latitude,
          lng: newLocation.longitude,
        })
        setReceiverLastUpdate(new Date())
      }
    })

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
      stopReceiverTracking()
      setReceiverTrackingActive(false)
      unsubscribeLocation()
      unsubscribeAlert?.unsubscribe()
      hideEmergencyAlert()
    }
    // Only depend on alert.id and user.id, not the full alert object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id, user?.id, router, permissionStatus])

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
            <p className="font-medium capitalize">{alert.alert_type.replace('_', ' ')}</p>
          </div>

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

