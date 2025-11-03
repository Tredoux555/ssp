'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'

export default function HomePage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    // Add timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.warn('Loading timeout - redirecting to login')
        router.push('/auth/login')
      }
    }, 6000) // 6 second timeout

    if (!loading) {
      clearTimeout(timeoutId)
      if (user) {
        router.push('/dashboard')
      } else {
        router.push('/auth/login')
      }
    }

    return () => clearTimeout(timeoutId)
  }, [user, loading, router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">PSP</h1>
        <p className="text-white/90">Loading...</p>
        {loading && (
          <p className="text-white/70 text-sm mt-2">
            Please wait...
          </p>
        )}
      </div>
    </div>
  )
}
