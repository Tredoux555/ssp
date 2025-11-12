'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

function VerifyContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const verifyEmail = async () => {
      const code = searchParams.get('code')
      const token = searchParams.get('token')
      const type = searchParams.get('type') || 'email'

      if (!code && !token) {
        setError('No verification code found in the link')
        setLoading(false)
        return
      }

      const supabase = createClient()

      if (!supabase) {
        setError('Failed to initialize authentication. Please try again.')
        setLoading(false)
        return
      }

      try {
        if (code) {
          // Verify with code (Supabase sends this in the email link)
          const { data, error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: code,
            type: type as any,
          })

          if (verifyError) {
            // Provide user-friendly error messages
            if (verifyError.message.includes('expired') || verifyError.message.includes('invalid')) {
              setError('Verification link has expired or is invalid. Please request a new verification email.')
            } else {
              setError(verifyError.message || 'Verification failed. Please try again.')
            }
          } else if (data?.user) {
            setVerified(true)
            // Refresh session to get updated user
            try {
              await supabase.auth.getSession()
            } catch (sessionError) {
              console.warn('Failed to refresh session after verification:', sessionError)
              // Don't fail verification if session refresh fails
            }
          } else {
            setError('Verification completed but user data is missing. Please try signing in.')
          }
        } else if (token) {
          // Verify with token (alternative method)
          const { data, error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: token,
            type: type as any,
          })

          if (verifyError) {
            if (verifyError.message.includes('expired') || verifyError.message.includes('invalid')) {
              setError('Verification link has expired or is invalid. Please request a new verification email.')
            } else {
              setError(verifyError.message || 'Verification failed. Please try again.')
            }
          } else if (data?.user) {
            setVerified(true)
            try {
              await supabase.auth.getSession()
            } catch (sessionError) {
              console.warn('Failed to refresh session after verification:', sessionError)
            }
          } else {
            setError('Verification completed but user data is missing. Please try signing in.')
          }
        }
      } catch (err: any) {
        console.error('Verification error:', err)
        setError(err.message || 'Verification failed. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    verifyEmail()
  }, [searchParams])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center p-4">
        <Card className="max-w-md">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-sa-green animate-spin mx-auto mb-4" />
            <p className="text-gray-700 font-medium">Verifying your email...</p>
            <p className="text-sm text-gray-500 mt-2">Please wait</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <div className="text-center">
          {verified ? (
            <>
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Email Verified!</h1>
              <p className="text-gray-600 mb-6">
                Your email has been successfully verified. You can now access all features.
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={() => router.push('/dashboard')}
                className="w-full"
              >
                Go to Dashboard
              </Button>
            </>
          ) : (
            <>
              <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Verification Failed</h1>
              <p className="text-gray-600 mb-6">
                {error || 'Invalid or expired verification link. Please try signing up again.'}
              </p>
              <div className="space-y-2">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => router.push('/auth/register')}
                  className="w-full"
                >
                  Sign Up Again
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => router.push('/auth/login')}
                  className="w-full"
                >
                  Back to Login
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center p-4">
          <Card className="max-w-md">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-sa-green animate-spin mx-auto mb-4" />
              <p className="text-gray-700 font-medium">Loading...</p>
            </div>
          </Card>
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  )
}




