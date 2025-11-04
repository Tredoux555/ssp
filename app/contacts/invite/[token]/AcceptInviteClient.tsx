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
        // Get invite info from Supabase directly
        const { createClient } = await import('@/lib/supabase')
        const supabase = createClient()
        
        const { data: invite, error } = await supabase
          .from('contact_invites')
          .select('target_email, expires_at')
          .eq('token', token)
          .single()
        
        if (error || !invite) {
          throw new Error(error?.message || 'Failed to load invite')
        }
        
        // Mask email
        const emailParts = invite.target_email.split('@')
        const maskedEmail = emailParts[0].substring(0, 2) + '***@' + emailParts[1]
        
        setInviteInfo({ target_email_masked: maskedEmail, expires_at: invite.expires_at })
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
      const { acceptContactInvite } = await import('@/lib/services/contacts')
      await acceptContactInvite(token)
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

