'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import Card from '@/components/Card'
import Button from '@/components/Button'

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { user, loading } = useAuth()
  const [inviteInfo, setInviteInfo] = useState<{ target_email_masked: string; expires_at: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    const fetchInvite = async () => {
      try {
        const res = await fetch(`/api/contacts/invite/${token}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load invite')
        setInviteInfo({ target_email_masked: data.target_email_masked, expires_at: data.expires_at })
      } catch (e: any) {
        setError(e.message || 'Failed to load invite')
      }
    }
    fetchInvite()
  }, [token])

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.push(`/auth/login?next=/contacts/invite/${token}`)
    }
  }, [user, loading, router, token])

  const handleAccept = async () => {
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/contacts/invite/${token}/accept`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to accept invite')
      router.push('/contacts')
    } catch (e: any) {
      setError(e.message || 'Failed to accept invite')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Contact Invite</h1>
          {!inviteInfo && !error && (
            <p>Loading invite...</p>
          )}
          {error && (
            <p className="text-red-600">{error}</p>
          )}
          {inviteInfo && (
            <>
              <p className="text-gray-700">You are invited to be a contact.</p>
              <p className="text-gray-700 mt-1">Email: {inviteInfo.target_email_masked}</p>
              <div className="mt-4 space-y-2">
                <Button onClick={handleAccept} disabled={submitting} className="w-full" variant="primary">
                  {submitting ? 'Accepting...' : 'Accept Invite'}
                </Button>
                <Button onClick={() => router.push('/contacts')} variant="secondary" className="w-full">
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}


