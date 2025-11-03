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
    // Skip redirect logic if we're already on a specific page (not root)
    // This prevents redirecting away from login/register pages
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      return
    }

    // Single timeout as absolute failsafe (5 seconds)
    let timeoutId: NodeJS.Timeout | null = null

    // Absolute failsafe timeout - only fires if auth state never resolves
    timeoutId = setTimeout(() => {
      if (loading && !redirectAttempted) {
        console.warn('Loading timeout (5s) - forcing redirect to login')
        setTimeoutReached(true)
        setRedirectAttempted(true)
        window.location.href = '/auth/login'
      }
    }, 5000)

    // If loading completes, clear timeout and navigate immediately
    if (!loading && !redirectAttempted) {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      
      // Navigate immediately - no delay needed
      // AuthContext has already set user state via onAuthStateChange
      setRedirectAttempted(true)
      
      if (user) {
        window.location.href = '/dashboard'
      } else {
        window.location.href = '/auth/login'
      }
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [user, loading, redirectAttempted])

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

