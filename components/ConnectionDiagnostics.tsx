'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/contexts/AuthContext'
import { runAllConnectionTests, ConnectionTestResult, ConnectionTestResults } from '@/lib/diagnostics/connection-test'
import Card from '@/components/Card'
import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'

export default function ConnectionDiagnostics() {
  const { user } = useAuth()
  const [results, setResults] = useState<ConnectionTestResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runTests = async () => {
    if (!user) {
      setError('User not authenticated')
      return
    }

    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const testResults = await runAllConnectionTests(user.id)
      setResults(testResults)
    } catch (err: any) {
      setError(err.message || 'Failed to run tests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) {
      // Add small delay to prevent blocking initial render
      const timer = setTimeout(() => {
        runTests()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [user])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />
      default:
        return null
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'border-green-500 bg-green-50'
      case 'error':
        return 'border-red-500 bg-red-50'
      case 'warning':
        return 'border-yellow-500 bg-yellow-50'
      default:
        return 'border-gray-300 bg-gray-50'
    }
  }

  if (!user) {
    return (
      <Card className="p-6">
        <div className="text-center text-gray-600">
          Please log in to run connection diagnostics
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Connection Diagnostics</h2>
          <button
            onClick={runTests}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running Tests...
              </>
            ) : (
              'Run Tests Again'
            )}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-800">
            Error: {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
            <p className="text-gray-600">Running connection tests...</p>
          </div>
        )}

        {results && (
          <div className="space-y-3">
            <div className={`p-4 rounded-lg border-2 ${getStatusColor(results.overallStatus)}`}>
              <div className="flex items-center gap-2 mb-2">
                {getStatusIcon(results.overallStatus)}
                <h3 className="font-semibold text-lg">
                  Overall Status: {results.overallStatus.toUpperCase()}
                </h3>
              </div>
              <p className="text-sm text-gray-700">
                {results.tests.filter(t => t.status === 'success').length} of {results.tests.length} tests passed
              </p>
            </div>

            <div className="space-y-2">
              {results.tests.map((test, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border ${getStatusColor(test.status)}`}
                >
                  <div className="flex items-start gap-3">
                    {getStatusIcon(test.status)}
                    <div className="flex-1">
                      <h4 className="font-semibold mb-1">{test.name}</h4>
                      <p className="text-sm text-gray-700 mb-2">{test.message}</p>
                      {test.details && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                            View Details
                          </summary>
                          <pre className="mt-2 p-2 bg-gray-100 rounded overflow-auto text-xs">
                            {JSON.stringify(test.details, null, 2)}
                          </pre>
                        </details>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        {test.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-2">What These Tests Check</h3>
        <ul className="space-y-1 text-sm text-gray-600">
          <li>• <strong>Supabase Client:</strong> Can create and authenticate with Supabase</li>
          <li>• <strong>Database Access:</strong> Can query emergency_alerts table</li>
          <li>• <strong>RLS Policy:</strong> Can see alerts where user is in contacts_notified</li>
          <li>• <strong>Real-time Subscription:</strong> Can connect to Supabase Realtime</li>
          <li>• <strong>Push Notifications:</strong> Push API endpoint is accessible</li>
          <li>• <strong>Contact Relationships:</strong> User has verified contacts with linked accounts</li>
        </ul>
      </Card>
    </div>
  )
}


