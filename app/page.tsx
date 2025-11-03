'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'

export default function HomePage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [timeoutReached, setTimeoutReached] = useState(false)
  const [redirectAttempted, setRedirectAttempted] = useState(false)

  // Force navigation function that works on mobile - always use window.location
  const forceNavigate = (path: string) => {
    // Always use window.location.href on mobile for reliability
    window.location.href = path
  }

  useEffect(() => {
    // Multiple timeouts as backup for mobile reliability
    let timeoutId1: NodeJS.Timeout | null = null
    let timeoutId2: NodeJS.Timeout | null = null
    let timeoutId3: NodeJS.Timeout | null = null

    // Primary timeout - 2 seconds
    timeoutId1 = setTimeout(() => {
      if (loading) {
        console.warn('Loading timeout (2s) - forcing redirect to login')
        setTimeoutReached(true)
        setRedirectAttempted(true)
        // Direct window.location - most reliable on mobile
        window.location.href = '/auth/login'
      }
    }, 2000)

    // Backup timeout - 3 seconds (if first didn't work)
    timeoutId2 = setTimeout(() => {
      if (loading) {
        console.warn('Loading timeout (3s) - force redirect')
        window.location.href = '/auth/login'
      }
    }, 3000)

    // Final fallback - 5 seconds (absolute failsafe)
    timeoutId3 = setTimeout(() => {
      console.warn('Loading timeout (5s) - absolute fallback')
      window.location.href = '/auth/login'
    }, 5000)

    // If loading completes, clear timeouts and navigate
    if (!loading) {
      if (timeoutId1) clearTimeout(timeoutId1)
      if (timeoutId2) clearTimeout(timeoutId2)
      if (timeoutId3) clearTimeout(timeoutId3)
      
      // Navigate immediately when loading finishes
      if (!redirectAttempted) {
        setRedirectAttempted(true)
        // Use direct window.location for mobile reliability
        if (user) {
          window.location.href = '/dashboard'
        } else {
          window.location.href = '/auth/login'
        }
      }
    }

    return () => {
      if (timeoutId1) clearTimeout(timeoutId1)
      if (timeoutId2) clearTimeout(timeoutId2)
      if (timeoutId3) clearTimeout(timeoutId3)
    }
  }, [user, loading, router, redirectAttempted])

  // Manual retry button if timeout is reached
  const handleRetry = () => {
    setRedirectAttempted(false)
    setTimeoutReached(false)
    // Force refresh to restart auth check
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">PSP</h1>
        <p className="text-white/90">Loading...</p>
        {loading && !timeoutReached && (
          <p className="text-white/70 text-sm mt-2">
            Please wait...
          </p>
        )}
        {timeoutReached && (
          <div className="mt-4 space-y-3">
            <p className="text-white/90 text-sm">
              Taking longer than expected...
            </p>
            <button
              onClick={() => window.location.href = '/auth/login'}
              className="block w-full px-4 py-2 bg-sa-green text-white rounded-lg font-medium hover:bg-green-600 transition-colors"
            >
              Go to Login Now
            </button>
            <button
              onClick={handleRetry}
              className="block w-full px-4 py-2 bg-white text-sa-green rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
