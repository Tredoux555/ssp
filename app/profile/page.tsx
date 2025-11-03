'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { createClient } from '@/lib/supabase'
import Button from '@/components/Button'
import Card from '@/components/Card'
import Input from '@/components/Input'
import { ArrowLeft, User, Mail, Phone } from 'lucide-react'

export default function ProfilePage() {
  const router = useRouter()
  const { user, profile, refreshProfile, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
  })

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        phone: profile.phone || '',
      })
    }
  }, [profile])

  const handleUpdate = async () => {
    if (!user) return

    // Validation
    if (formData.phone && formData.phone.trim().length > 0) {
      // Basic phone validation - just check it's not too short
      const phoneTrimmed = formData.phone.trim()
      if (phoneTrimmed.length < 7) {
        alert('Phone number is too short. Please provide a valid phone number.')
        return
      }
    }

    setLoading(true)
    const supabase = createClient()

    if (!supabase) {
      alert('Failed to connect to server. Please refresh the page and try again.')
      setLoading(false)
      return
    }

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          full_name: formData.full_name?.trim() || null,
          phone: formData.phone?.trim() || null,
        })
        .eq('id', user.id)

      if (error) {
        if (error.code === '42501' || error.message.includes('row-level security')) {
          throw new Error('You do not have permission to update your profile')
        }
        throw new Error(error.message || 'Failed to update profile')
      }

      await refreshProfile()
      alert('Profile updated successfully')
    } catch (error: any) {
      console.error('Update profile error:', error)
      alert(`Failed to update profile: ${error.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
        <p className="text-white">Loading...</p>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Button>
          <h1 className="text-3xl font-bold text-white">Profile Settings</h1>
        </div>

        <Card>
          <div className="space-y-6">
            {/* User Info */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-gray-600" />
                <div>
                  <p className="text-sm text-gray-600">Full Name</p>
                  <p className="font-semibold">{profile?.full_name || 'Not set'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-600" />
                <div>
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="font-semibold">{user.email}</p>
                </div>
              </div>
              {profile?.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-gray-600" />
                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="font-semibold">{profile.phone}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Edit Form */}
            <div className="space-y-4">
              <Input
                label="Full Name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="John Doe"
              />
              <Input
                label="Phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+27 12 345 6789"
              />
              <Button
                variant="primary"
                size="lg"
                onClick={handleUpdate}
                disabled={loading}
                className="w-full"
              >
                {loading ? 'Updating...' : 'Update Profile'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

