'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { createClient } from '@/lib/supabase'
import { subscribeToLocationHistory, subscribeToAlertResponses } from '@/lib/realtime/subscriptions'
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
    const supabase = createClient()
    const channel = supabase
      .channel(`alert-${alert.id}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'emergency_alerts',
          filter: `id=eq.${alert.id}`,
        },
        (payload: any) => {
          setAlert(payload.new as EmergencyAlert)
        }
      )
      .subscribe()

    // Load initial location history
    loadLocationHistory()

    return () => {
      unsubscribeLocation()
      supabase.removeChannel(channel)
    }
  }, [alert, user])

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
    if (!alert) return

    const supabase = createClient()

    try {
      const { data } = await supabase
        .from('location_history')
        .select('*')
        .eq('alert_id', alert.id)
        .order('timestamp', { ascending: false })
        .limit(50)

      if (data && data.length > 0) {
        setLocationHistory(data as LocationHistory[])
        setLocation(data[0] as LocationHistory)
      }
    } catch (error) {
      console.error('Failed to load location history:', error)
    }
  }

  const handleAcknowledge = async () => {
    if (!user || !alert) return

    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('alert_responses')
        .update({
          acknowledged_at: new Date().toISOString(),
        })
        .eq('alert_id', alert.id)
        .eq('contact_user_id', user.id)

      if (error) throw error

      setAcknowledged(true)
    } catch (error: any) {
      window.alert(`Failed to acknowledge: ${error.message}`)
    }
  }

  const handleNavigate = () => {
    if (!location) return

    const url = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`
    window.open(url, '_blank')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-sa-red emergency-flash flex items-center justify-center">
        <div className="text-center text-white">
          <p>Loading emergency alert...</p>
        </div>
      </div>
    )
  }

  if (!alert) {
    return (
      <div className="min-h-screen bg-sa-red emergency-flash flex items-center justify-center">
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
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4">
      <div className="max-w-4xl mx-auto">
        {/* Emergency Alert Banner */}
        <Card className="mb-6 border-4 border-sa-red emergency-pulse bg-red-50">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-sa-red rounded-full flex items-center justify-center emergency-pulse">
              <AlertTriangle className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-sa-red mb-2">EMERGENCY ALERT</h1>
              <p className="text-gray-700">
                Someone in your contacts is in immediate danger
              </p>
            </div>
          </div>
          <div className="bg-white rounded-lg p-4">
            <p className="font-semibold text-gray-900 mb-2">Alert Type:</p>
            <p className="text-lg text-gray-700 capitalize">
              {alert.alert_type.replace('_', ' ')}
            </p>
          </div>
        </Card>

        {/* Location Map */}
        {location && (
          <Card className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-5 h-5 text-sa-red" />
              <h2 className="text-xl font-bold">Location</h2>
            </div>
            <div className="w-full h-96 rounded-lg overflow-hidden">
              <GoogleMapComponent
                latitude={location.latitude}
                longitude={location.longitude}
                alertId={alert.id}
                user_id={alert.user_id}
              />
            </div>
            <Button
              variant="emergency"
              size="lg"
              onClick={handleNavigate}
              className="w-full mt-4 flex items-center justify-center gap-2"
            >
              <Navigation className="w-5 h-5" />
              Navigate to Location
            </Button>
          </Card>
        )}

        {/* Actions */}
        <Card>
          <div className="space-y-4">
            {!acknowledged ? (
              <Button
                variant="primary"
                size="lg"
                onClick={handleAcknowledge}
                className="w-full flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-5 h-5" />
                I'm On My Way
              </Button>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-green-700 font-semibold">You've acknowledged this alert</p>
              </div>
            )}

            <Button
              variant="secondary"
              onClick={() => router.push('/dashboard')}
              className="w-full"
            >
              <X className="w-4 h-4 mr-2 inline" />
              Return to Dashboard
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

