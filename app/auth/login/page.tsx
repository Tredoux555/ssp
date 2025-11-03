'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import Button from '@/components/Button'
import Input from '@/components/Input'
import Card from '@/components/Card'
import { AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      
      console.log('Navigating to dashboard after successful sign-in')
      
      // Wait a bit more to ensure onAuthStateChange has updated state
      // This ensures session is available when dashboard loads
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Navigate to dashboard
      window.location.href = '/dashboard'
    } catch (err: any) {
      console.error('Sign-in error:', err)
      setError(err.message || 'Failed to sign in')
      setLoading(false)
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
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
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

