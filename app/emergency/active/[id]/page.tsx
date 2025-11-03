'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { getActiveEmergency } from '@/lib/emergency'
import { startLocationTracking, getCurrentLocation, reverseGeocode } from '@/lib/location'
import { EmergencyAlert } from '@/types/database'
import Button from '@/components/Button'
import { AlertTriangle, X, MapPin } from 'lucide-react'

export default function EmergencyActivePage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const alertId = params.id as string
  const [alert, setAlert] = useState<EmergencyAlert | null>(null)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [address, setAddress] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    loadAlert()
  }, [user, alertId])

  useEffect(() => {
    if (!alert || !user) return

    // Start location tracking
    const stopTracking = startLocationTracking(
      user.id,
      alert.id,
      async (loc) => {
        setLocation(loc)
        if (!address && loc) {
          const addr = await reverseGeocode(loc.lat, loc.lng)
          if (addr) setAddress(addr)
        }
      },
      10000 // Update every 10 seconds
    )

    // Get initial location
    getCurrentLocation()
      .then(async (loc) => {
        setLocation(loc)
        const addr = await reverseGeocode(loc.lat, loc.lng)
        if (addr) setAddress(addr)
      })
      .catch(console.error)

    // Play alert sound (requires user interaction in modern browsers)
    let audio: HTMLAudioElement | null = null
    let audioLoaded = false
    
    try {
      audio = new Audio('/emergency-alert.mp3')
      audio.loop = true
      audio.volume = 1.0
      
      // Handle audio loading errors (file not found, network issues, etc.)
      audio.addEventListener('error', (e) => {
        // Audio file may not exist - that's ok, we'll just skip audio
        // Only log if it's not a simple 404/network error
        const error = audio?.error
        if (error && error.code !== error.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          console.warn('Audio loading error:', error)
        }
        audio = null
      })
      
      audio.addEventListener('canplaythrough', () => {
        audioLoaded = true
      })
      
      // Try to play - will fail if no user interaction yet (modern browser requirement)
      audio.play().catch((error) => {
        // NotSupportedError is expected when autoplay is blocked
        if (error.name !== 'NotSupportedError' && error.name !== 'NotAllowedError') {
          console.warn('Audio playback error:', error)
        }
      })
    } catch (error) {
      console.warn('Could not create audio element:', error)
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
    }
  }, [alert, user, address])

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
      // Use API route instead of direct client call to avoid RLS issues
      const response = await fetch('/api/emergency/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alert_id: alert.id }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error || `Failed to cancel alert (${response.status})`)
      }

      const data = await response.json().catch(() => ({}))
      
      // Successfully cancelled - redirect to dashboard
      router.push('/dashboard')
    } catch (error: any) {
      console.error('Cancel alert error:', error)
      const errorMessage = error?.message || 'Failed to cancel alert. Please try again.'
      window.alert(errorMessage)
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
    <div className="min-h-screen bg-sa-red emergency-flash flex flex-col items-center justify-center p-4 text-white">
      <div className="max-w-md w-full text-center">
        {/* Alert Icon */}
        <div className="mb-6 emergency-pulse">
          <AlertTriangle className="w-24 h-24 mx-auto text-white" />
        </div>

        {/* Alert Message */}
        <h1 className="text-4xl font-bold mb-4">EMERGENCY ALERT</h1>
        <p className="text-xl mb-2">Your alert has been sent</p>
        <p className="text-lg mb-6 opacity-90">
          Your contacts are being notified with your location
        </p>

        {/* Location Info */}
        {location && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 mb-6">
            <div className="flex items-center justify-center gap-2 mb-2">
              <MapPin className="w-5 h-5" />
              <span className="font-medium">Your Location</span>
            </div>
            {address && (
              <p className="text-sm opacity-90">{address}</p>
            )}
            <p className="text-xs opacity-75 mt-1">
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
            </p>
          </div>
        )}

        {/* Alert Type */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 mb-6">
          <p className="text-sm opacity-75">Alert Type</p>
          <p className="text-lg font-semibold capitalize">{alert.alert_type.replace('_', ' ')}</p>
        </div>

        {/* Cancel Button */}
        <Button
          variant="secondary"
          size="lg"
          onClick={handleCancel}
          className="w-full mb-4"
        >
          <X className="w-5 h-5 mr-2 inline" />
          Cancel Alert
        </Button>

        {/* Help Text */}
        <p className="text-xs opacity-75">
          Keep this screen open so your location updates in real-time
        </p>
      </div>
    </div>
  )
}

