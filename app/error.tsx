'use client'

import { useEffect } from 'react'
import Button from '@/components/Button'
import { AlertTriangle } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log error to console for debugging
    console.error('Application error:', error)
    
    // Mark that we're in an error state to prevent dashboard auto-redirect
    sessionStorage.setItem('emergency-error-state', 'true')
    
    // Clear it after 10 seconds (enough time to navigate away)
    const timeout = setTimeout(() => {
      sessionStorage.removeItem('emergency-error-state')
    }, 10000)
    
    return () => clearTimeout(timeout)
  }, [error])

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
        <p className="text-gray-600 mb-6">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <div className="space-y-3">
          <Button
            onClick={reset}
            variant="primary"
            className="w-full"
          >
            Try again
          </Button>
          <Button
            onClick={() => {
              // Navigate directly to dashboard to avoid redirect loops
              window.location.href = '/dashboard'
            }}
            variant="secondary"
            className="w-full"
          >
            Go to home
          </Button>
        </div>
      </div>
    </div>
  )
}

