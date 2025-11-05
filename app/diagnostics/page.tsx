'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import ConnectionDiagnostics from '@/components/ConnectionDiagnostics'
import Card from '@/components/Card'
import { Loader2 } from 'lucide-react'

export default function DiagnosticsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
        <Card className="p-8">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
            <p className="text-gray-600">Loading...</p>
          </div>
        </Card>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4">
      <div className="max-w-4xl mx-auto">
        <Card className="p-6 mb-4">
          <h1 className="text-3xl font-bold mb-2">Connection Diagnostics</h1>
          <p className="text-gray-600">
            Test the connection path for emergency alerts to identify where issues occur.
          </p>
        </Card>

        <ConnectionDiagnostics />
      </div>
    </div>
  )
}


