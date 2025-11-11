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
    console.log(`[Login] Starting auth state polling for mobile: ${isMobile}`)
    
    // Poll for auth state update with timeout (same for both mobile and desktop)
    const maxWaitTime = 25000 // 25s for both mobile and desktop
    const checkInterval = 1000 // Check every 1s for both mobile and desktop
    const maxChecks = maxWaitTime / checkInterval
    
    let checks = 0
    let intervalId: NodeJS.Timeout | null = null
    let sessionCheckAttempted = false
    
    const checkAuthState = async () => {
      checks++
      
      // Check if user is set and auth loading is complete
      if (user && !authLoading) {
        console.log('[Login] ✅ Auth state updated - navigating to dashboard')
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
        setWaitingForAuth(false)
        
        // Use window.location.href for mobile reliability
        window.location.href = '/dashboard'
        return
      }
      
      // Fallback: Directly check session if auth state hasn't updated after a few checks
      if (!sessionCheckAttempted && checks >= 3) {
        sessionCheckAttempted = true
        console.log('[Login] 🔍 Checking session directly as fallback...')
        try {
          const { createClient } = await import('@/lib/supabase')
          const supabase = createClient()
          if (supabase) {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession()
            if (!sessionError && session?.user) {
              console.log('[Login] ✅ Session found directly - navigating to dashboard')
              if (intervalId) {
                clearInterval(intervalId)
                intervalId = null
              }
              setWaitingForAuth(false)
              window.location.href = '/dashboard'
              return
            }
          }
        } catch (sessionErr) {
          console.warn('[Login] Session check failed:', sessionErr)
        }
      }
      
      // Timeout reached
      if (checks >= maxChecks) {
        console.warn(`[Login] ⏱️ Auth state update timeout after ${maxWaitTime}ms - checking session directly`)
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
        
        // Final attempt: Check session directly
        const checkSessionDirectly = async () => {
          try {
            const { createClient } = await import('@/lib/supabase')
            const supabase = createClient()
            if (supabase) {
              const { data: { session }, error: sessionError } = await supabase.auth.getSession()
              if (!sessionError && session?.user) {
                console.log('[Login] ✅ Session found in final check - navigating to dashboard')
                setWaitingForAuth(false)
                window.location.href = '/dashboard'
                return
              }
            }
          } catch (sessionErr) {
            console.warn('[Login] Final session check failed:', sessionErr)
          }
          
          // No session found - sign-in may have failed
          console.error('[Login] ❌ Auth state update timeout - no user found')
          setWaitingForAuth(false)
          setError(isMobile 
            ? 'Sign-in timed out. Please check your internet connection and try again. If the problem persists, try closing and reopening the app.'
            : 'Sign-in completed but authentication state did not update. Please try again.')
          setLoading(false)
          setSignInSuccess(false)
        }
        
        checkSessionDirectly()
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
    setSignInSuccess(false)
    setWaitingForAuth(false)

    try {
      console.log(`[Login] 🚀 Starting sign-in... (mobile: ${isMobile})`, {
        isMobile,
        cookieEnabled: navigator.cookieEnabled,
        hasLocalStorage: typeof Storage !== 'undefined',
        userAgent: navigator.userAgent.substring(0, 50)
      })
      
      // Add retry logic for network errors (more retries on mobile)
      let retries = 0
      const maxRetries = isMobile ? 3 : 2
      let lastError: any = null
      
      while (retries <= maxRetries) {
        try {
          console.log(`[Login] Attempt ${retries + 1}/${maxRetries + 1}...`)
          await signIn(email, password)
          console.log('[Login] ✅ signIn completed successfully')
          lastError = null
          break // Success - exit retry loop
        } catch (err: any) {
          lastError = err
          const isNetworkError = err?.message?.includes('network') || 
                                 err?.message?.includes('fetch') ||
                                 err?.message?.includes('timeout') ||
                                 err?.message?.includes('connection') ||
                                 err?.message?.includes('Failed to fetch')
          
          console.warn(`[Login] Attempt ${retries + 1} failed:`, err.message)
          
          if (isNetworkError && retries < maxRetries) {
            retries++
            const retryDelay = isMobile ? 2000 : 1000 // 2s mobile, 1s desktop
            console.warn(`[Login] ⏳ Network error detected, retrying in ${retryDelay}ms... (${retries}/${maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, retryDelay))
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
      
      console.log('[Login] ✅ Sign-in successful - waiting for auth state update')
      
      // Mark sign-in as successful - useEffect will handle navigation
      setSignInSuccess(true)
      // Don't set loading to false yet - wait for auth state update
      // Loading will be set to false when navigation happens or error occurs
      
    } catch (err: any) {
      console.error('[Login] ❌ Sign-in error:', err)
      
      // Provide mobile-specific error messages
      let errorMessage = err.message || 'Failed to sign in'
      
      if (isMobile && (errorMessage.includes('timeout') || errorMessage.includes('network'))) {
        errorMessage = 'Connection timeout. Please check your internet connection and try again. If you\'re on a slow network, try moving to a better location.'
      } else if (errorMessage.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password. Please check your credentials and try again.'
      } else if (errorMessage.includes('Email not confirmed')) {
        errorMessage = 'Please verify your email address before signing in.'
      } else if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
        errorMessage = 'Network error. Please check your internet connection and try again.'
      }
      
      setError(errorMessage)
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

