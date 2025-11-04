'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import Button from '@/components/Button'
import Input from '@/components/Input'
import Card from '@/components/Card'
import { AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const { signIn, user, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signInSuccess, setSignInSuccess] = useState(false)
  const [waitingForAuth, setWaitingForAuth] = useState(false)

  // Detect mobile device
  const isMobile = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  
  // Watch for auth state changes after successful sign-in
  useEffect(() => {
    // Only start polling if sign-in succeeded and we're not already waiting
    if (!signInSuccess || waitingForAuth) {
      return
    }
    
    // Start waiting for auth state update
    setWaitingForAuth(true)
    
    // Poll for auth state update with timeout
    const maxWaitTime = isMobile ? 15000 : 10000 // 15s mobile, 10s desktop
    const checkInterval = 500 // Check every 500ms
    const maxChecks = maxWaitTime / checkInterval
    
    let checks = 0
    let intervalId: NodeJS.Timeout | null = null
    
    const checkAuthState = () => {
      checks++
      
      // Check if user is set and auth loading is complete
      if (user && !authLoading) {
        console.log('Auth state updated - navigating to dashboard')
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
        setWaitingForAuth(false)
        
        // Small delay to ensure state is stable
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 100)
        return
      }
      
      // Timeout reached
      if (checks >= maxChecks) {
        console.warn('Auth state update timeout - checking if user exists anyway')
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
        setWaitingForAuth(false)
        
        // If user exists but we didn't detect it, navigate anyway
        if (user) {
          console.log('User exists - navigating to dashboard')
          window.location.href = '/dashboard'
        } else {
          // No user - sign-in may have failed
          console.error('Auth state update timeout - no user found')
          setError('Sign-in completed but authentication state did not update. Please try again.')
          setLoading(false)
          setSignInSuccess(false)
        }
      }
    }
    
    // Start polling
    intervalId = setInterval(checkAuthState, checkInterval)
    
    // Also check immediately in case state is already updated
    checkAuthState()
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
  }, [signInSuccess, waitingForAuth, user, authLoading, isMobile])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      console.log('Calling signIn...')
      
      // Add retry logic for network errors (max 2 retries)
      let retries = 0
      const maxRetries = 2
      let lastError: any = null
      
      while (retries <= maxRetries) {
        try {
          await signIn(email, password)
          console.log('signIn completed successfully')
          lastError = null
          break // Success - exit retry loop
        } catch (err: any) {
          lastError = err
          const isNetworkError = err?.message?.includes('network') || 
                                 err?.message?.includes('fetch') ||
                                 err?.message?.includes('timeout')
          
          if (isNetworkError && retries < maxRetries) {
            retries++
            console.warn(`Sign-in attempt ${retries} failed with network error, retrying...`)
            // Wait 1 second before retry
            await new Promise(resolve => setTimeout(resolve, 1000))
            continue
          } else {
            // Not a network error or max retries reached
            throw err
          }
        }
      }
      
      if (lastError) {
        throw lastError
      }
      
      console.log('Sign-in successful - waiting for auth state update')
      
      // Mark sign-in as successful - useEffect will handle navigation
      setSignInSuccess(true)
      // Don't set loading to false yet - wait for auth state update
      // Loading will be set to false when navigation happens or error occurs
      
    } catch (err: any) {
      console.error('Sign-in error:', err)
      setError(err.message || 'Failed to sign in')
      setLoading(false)
      setSignInSuccess(false)
      setWaitingForAuth(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-sa-green mb-2">PSP</h1>
          <p className="text-gray-600">Personal Security Program</p>
          <p className="text-sm text-gray-500 mt-2">Sign in to your account</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            placeholder="your@email.com"
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            placeholder="••••••••"
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={loading || waitingForAuth}
          >
            {waitingForAuth 
              ? (isMobile ? 'Signing in... Please wait...' : 'Signing in...')
              : loading 
              ? 'Signing in...' 
              : 'Sign In'}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Don't have an account?{' '}
            <button
              onClick={() => router.push('/auth/register')}
              className="text-sa-green hover:underline font-medium"
            >
              Sign up
            </button>
          </p>
        </div>
      </Card>
    </div>
  )
}

