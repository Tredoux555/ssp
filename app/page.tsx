'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'

export default function HomePage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [timeoutReached, setTimeoutReached] = useState(false)
  const [redirectAttempted, setRedirectAttempted] = useState(false)

  // Force navigation function that works on mobile
  const forceNavigate = (path: string) => {
    try {
      // Try router.push first (preferred for Next.js navigation)
      router.push(path)
      
      // Fallback to window.location for mobile devices (more reliable)
      setTimeout(() => {
        if (window.location.pathname !== path) {
          console.warn('Router.push failed, using window.location fallback')
          window.location.href = path
        }
      }, 500)
    } catch (error) {
      console.error('Navigation error:', error)
      // Final fallback - direct window.location
      window.location.href = path
    }
  }

  useEffect(() => {
    // More aggressive timeout for mobile (3 seconds instead of 6)
    const timeoutId = setTimeout(() => {
      if (loading && !redirectAttempted) {
        console.warn('Loading timeout - forcing redirect to login')
        setTimeoutReached(true)
        setRedirectAttempted(true)
        forceNavigate('/auth/login')
      }
    }, 3000) // Reduced to 3 seconds for faster mobile experience

    if (!loading && !redirectAttempted) {
      clearTimeout(timeoutId)
      setRedirectAttempted(true)
      
      // Small delay to ensure state is stable
      setTimeout(() => {
        if (user) {
          forceNavigate('/dashboard')
        } else {
          forceNavigate('/auth/login')
        }
      }, 100)
    }

    return () => clearTimeout(timeoutId)
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
              onClick={handleRetry}
              className="px-4 py-2 bg-white text-sa-green rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => forceNavigate('/auth/login')}
              className="block w-full px-4 py-2 bg-sa-green text-white rounded-lg font-medium hover:bg-green-600 transition-colors mt-2"
            >
              Go to Login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
