'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { getActiveEmergency, createEmergencyAlert, checkRateLimit } from '@/lib/emergency'
import { getCurrentLocation, reverseGeocode } from '@/lib/location'
import { getEmergencyContacts } from '@/lib/emergency'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { AlertTriangle, Users, Phone, MapPin, LogOut } from 'lucide-react'
import { EmergencyAlert } from '@/types/database'

export default function DashboardPage() {
  const router = useRouter()
  const { user, profile, signOut, loading: authLoading } = useAuth()
  const [activeEmergency, setActiveEmergency] = useState<EmergencyAlert | null>(null)
  const [emergencyLoading, setEmergencyLoading] = useState(false)
  const [contactCount, setContactCount] = useState(0)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) {
      loadActiveEmergency()
      loadContactCount()
    }
  }, [user])

  const loadActiveEmergency = async () => {
    if (!user) return

    try {
      const emergency = await getActiveEmergency(user.id)
      setActiveEmergency(emergency)
      
      if (emergency) {
        router.push(`/emergency/active/${emergency.id}`)
      }
    } catch (error: any) {
      console.error('Failed to load active emergency:', error)
      // Don't show error to user - just log it
      // Emergency might not exist, which is fine
      setActiveEmergency(null)
    }
  }

  const loadContactCount = async () => {
    if (!user) return

    try {
      const contacts = await getEmergencyContacts(user.id)
      setContactCount(contacts.length || 0)
    } catch (error: any) {
      console.error('Failed to load contacts:', error)
      // Set to 0 on error so UI doesn't break
      setContactCount(0)
    }
  }

  const handleEmergencyButton = async () => {
    if (!user) return

    // Check rate limit
    const canCreate = await checkRateLimit(user.id)
    if (!canCreate) {
      alert('Please wait 30 seconds before creating another emergency alert.')
      return
    }

    // Show confirmation
    const confirmed = window.confirm(
      'Are you in immediate danger?\n\n' +
      'This will send an emergency alert to all your contacts with your location.\n\n' +
      'Click OK to send the alert.'
    )

    if (!confirmed) return

    setEmergencyLoading(true)

    try {
      // Get current location (optional - continue without if fails)
      let location
      try {
        const coords = await getCurrentLocation()
        const address = await reverseGeocode(coords.lat, coords.lng).catch(() => null)
        location = {
          lat: coords.lat,
          lng: coords.lng,
          address: address || undefined,
        }
      } catch (error) {
        console.warn('Failed to get location, continuing without location:', error)
        // Continue without location - alert can still be created
      }

      // Create emergency alert
      let alert
      try {
        alert = await createEmergencyAlert(user.id, 'other', location)
      } catch (alertError: any) {
        throw new Error(`Failed to create emergency alert: ${alertError.message || 'Unknown error'}`)
      }

      // Get contacts and notify them (non-blocking)
      try {
        const contacts = await getEmergencyContacts(user.id)
        if (contacts.length > 0) {
          const { notifyEmergencyContacts } = await import('@/lib/emergency')
          await notifyEmergencyContacts(alert.id, user.id, contacts).catch((notifyError) => {
            console.error('Failed to notify contacts (non-critical):', notifyError)
            // Don't fail the alert creation if notification fails
          })
        }
      } catch (contactError) {
        console.error('Failed to get contacts (non-critical):', contactError)
        // Continue even if contact notification fails
      }

      // Navigate to emergency screen
      router.push(`/emergency/active/${alert.id}`)
    } catch (error: any) {
      console.error('Emergency button error:', error)
      const errorMessage = error?.message || 'Failed to create emergency alert. Please try again.'
      alert(errorMessage)
    } finally {
      setEmergencyLoading(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/auth/login')
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">PSP</h1>
          <p className="text-white/90">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">PSP</h1>
            <p className="text-white/90">Welcome, {profile?.full_name || user.email}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSignOut}
            className="flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
        </div>

        {/* Emergency Button */}
        <Card className="mb-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Emergency Alert</h2>
            <p className="text-gray-600 mb-6">
              Press this button if you are in immediate danger
            </p>
            <Button
              variant="emergency"
              size="lg"
              onClick={handleEmergencyButton}
              disabled={emergencyLoading}
              className="w-full py-8 text-2xl font-bold emergency-pulse"
            >
              {emergencyLoading ? (
                'Creating Alert...'
              ) : (
                <>
                  <AlertTriangle className="w-8 h-8 mr-2 inline" />
                  EMERGENCY
                </>
              )}
            </Button>
            <p className="text-xs text-gray-500 mt-4">
              Your location will be shared with your emergency contacts
            </p>
          </div>
        </Card>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-sa-green rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Emergency Contacts</p>
                <p className="text-2xl font-bold text-gray-900">{contactCount}</p>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-sa-blue rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Active Alerts</p>
                <p className="text-2xl font-bold text-gray-900">
                  {activeEmergency ? '1' : '0'}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => router.push('/contacts')}>
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-sa-green" />
              <span className="font-medium">Manage Contacts</span>
            </div>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => router.push('/profile')}>
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-sa-blue" />
              <span className="font-medium">Profile Settings</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

