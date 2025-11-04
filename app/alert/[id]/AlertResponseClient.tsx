'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { createClient } from '@/lib/supabase'
import { subscribeToLocationHistory, subscribeToAlertResponses } from '@/lib/realtime/subscriptions'
import { showEmergencyAlert, hideEmergencyAlert, playAlertSound, vibrateDevice } from '@/lib/notifications'
import { EmergencyAlert, LocationHistory } from '@/types/database'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { AlertTriangle, MapPin, Navigation, CheckCircle, X } from 'lucide-react'
import dynamic from 'next/dynamic'

// Dynamically import Google Maps to avoid SSR issues
const GoogleMapComponent = dynamic(
  () => import('@/components/EmergencyMap'),
  { ssr: false }
)

export default function AlertResponsePage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const alertId = params.id as string
  const [alert, setAlert] = useState<EmergencyAlert | null>(null)
  const [location, setLocation] = useState<LocationHistory | null>(null)
  const [locationHistory, setLocationHistory] = useState<LocationHistory[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      router.push('/auth/login')
      return
    }

    loadAlert()
  }, [user, alertId, router])

  useEffect(() => {
    if (!alert || !user) return

    // Subscribe to location updates
    const unsubscribeLocation = subscribeToLocationHistory(alert.id, (newLocation) => {
      setLocationHistory((prev) => [...prev, newLocation])
      setLocation(newLocation)
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

    // Subscribe to alert responses
    const unsubscribeResponses = subscribeToAlertResponses(alert.id, (response) => {
      // Handle new responses (e.g., update UI to show who acknowledged)
      console.log('New alert response:', response)
    })

    // Play alert sound and vibrate device
    playAlertSound()
    vibrateDevice()

    return () => {
      unsubscribeLocation()
      unsubscribeAlert?.unsubscribe()
      unsubscribeResponses()
      hideEmergencyAlert()
    }
  }, [alert, user, router])

  const loadAlert = async () => {
    if (!user) return

    const supabase = createClient()

    try {
      // Get alert - contact can see if they're in the contacts_notified array
      const { data, error } = await supabase
        .from('emergency_alerts')
        .select('*')
        .eq('id', alertId)
        .single()

      if (error) throw error

      const alertData = data as EmergencyAlert

      // Check if user is a contact
      if (!alertData.contacts_notified.includes(user.id)) {
        router.push('/dashboard')
        return
      }

      setAlert(alertData)

      // Show full-screen emergency alert with sound and vibration
      showEmergencyAlert(alertId, {
        address: alertData.address,
        alert_type: alertData.alert_type,
      })
      
      // Play sound and vibrate
      playAlertSound()
      vibrateDevice()

      // Check if user has acknowledged
      const { data: response } = await supabase
        .from('alert_responses')
        .select('*')
        .eq('alert_id', alertId)
        .eq('contact_user_id', user.id)
        .single()

      if (response?.acknowledged_at) {
        setAcknowledged(true)
      }

      // Get initial location
      if (alertData.location_lat && alertData.location_lng) {
        setLocation({
          id: 'initial',
          user_id: alertData.user_id,
          alert_id: alertId,
          latitude: alertData.location_lat,
          longitude: alertData.location_lng,
          timestamp: alertData.triggered_at,
          created_at: alertData.triggered_at,
        })
      }
    } catch (error) {
      console.error('Failed to load alert:', error)
      router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  const loadLocationHistory = async () => {
    if (!alert || !user) return

    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('location_history')
        .select('*')
        .eq('alert_id', alert.id)
        .order('created_at', { ascending: true })

      if (error) throw error

      if (data && data.length > 0) {
        setLocationHistory(data)
        setLocation(data[data.length - 1])
      }
    } catch (error) {
      console.error('Failed to load location history:', error)
    }
  }

  const handleAcknowledge = async () => {
    if (!user || !alert) return

    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('alert_responses')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('alert_id', alert.id)
        .eq('contact_user_id', user.id)

      if (error) throw error

      setAcknowledged(true)
    } catch (error) {
      console.error('Failed to acknowledge alert:', error)
      window.alert('Failed to acknowledge alert. Please try again.')
    }
  }

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
            <h1 className="text-2xl font-bold">Emergency Alert</h1>
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

        {location && (
          <div className="mb-6" style={{ height: '400px', width: '100%' }}>
            <GoogleMapComponent
              latitude={location.latitude}
              longitude={location.longitude}
              alertId={alert.id}
              user_id={alert.user_id}
            />
          </div>
        )}

        <div className="flex gap-4">
          <Button
            onClick={handleAcknowledge}
            variant="primary"
            disabled={acknowledged}
            className="flex-1"
          >
            {acknowledged ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Acknowledged
              </>
            ) : (
              'Acknowledge Alert'
            )}
          </Button>
          <Button
            onClick={() => router.push('/dashboard')}
            variant="secondary"
            className="flex-1"
          >
            <Navigation className="w-4 h-4 mr-2" />
            Get Directions
          </Button>
        </div>
      </Card>
    </div>
  )
}

