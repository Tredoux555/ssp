/**
 * Connection Test Utilities
 * Tests each step of the alert notification connection path
 */

import { createClient } from '@/lib/supabase'

export interface ConnectionTestResult {
  name: string
  status: 'success' | 'error' | 'warning'
  message: string
  details?: any
  timestamp: Date
}

export interface ConnectionTestResults {
  tests: ConnectionTestResult[]
  overallStatus: 'success' | 'error' | 'warning'
}

/**
 * Test Supabase client creation
 */
export async function testSupabaseClient(): Promise<ConnectionTestResult> {
  try {
    const supabase = createClient()
    
    if (!supabase) {
      return {
        name: 'Supabase Client Creation',
        status: 'error',
        message: 'Failed to create Supabase client - check environment variables',
        timestamp: new Date(),
      }
    }

    // Test basic connection by getting session
    const { data: { session }, error } = await supabase.auth.getSession()
    
    if (error) {
      return {
        name: 'Supabase Client Creation',
        status: 'error',
        message: `Client created but session check failed: ${error.message}`,
        details: error,
        timestamp: new Date(),
      }
    }

    return {
      name: 'Supabase Client Creation',
      status: 'success',
      message: `Client created successfully. User: ${session?.user?.email || 'Not authenticated'}`,
      details: {
        hasSession: !!session,
        userId: session?.user?.id,
        email: session?.user?.email,
      },
      timestamp: new Date(),
    }
  } catch (error: any) {
    return {
      name: 'Supabase Client Creation',
      status: 'error',
      message: `Error creating client: ${error.message}`,
      details: error,
      timestamp: new Date(),
    }
  }
}

/**
 * Test database query access
 */
export async function testDatabaseAccess(userId: string): Promise<ConnectionTestResult> {
  try {
    const supabase = createClient()
    
    if (!supabase) {
      return {
        name: 'Database Access',
        status: 'error',
        message: 'Supabase client not available',
        timestamp: new Date(),
      }
    }

    // Test querying emergency_alerts table
    const { data, error } = await supabase
      .from('emergency_alerts')
      .select('id, user_id, status, contacts_notified')
      .eq('status', 'active')
      .limit(5)

    if (error) {
      return {
        name: 'Database Access',
        status: 'error',
        message: `Failed to query emergency_alerts: ${error.message}`,
        details: {
          error: error,
          code: error.code,
          hint: error.hint,
        },
        timestamp: new Date(),
      }
    }

    return {
      name: 'Database Access',
      status: 'success',
      message: `Successfully queried emergency_alerts. Found ${data?.length || 0} active alerts`,
      details: {
        alertCount: data?.length || 0,
        alerts: data,
      },
      timestamp: new Date(),
    }
  } catch (error: any) {
    return {
      name: 'Database Access',
      status: 'error',
      message: `Error testing database access: ${error.message}`,
      details: error,
      timestamp: new Date(),
    }
  }
}

/**
 * Test RLS policy access - can user see alerts where they're in contacts_notified?
 */
export async function testRLSPolicyAccess(userId: string): Promise<ConnectionTestResult> {
  try {
    const supabase = createClient()
    
    if (!supabase) {
      return {
        name: 'RLS Policy Access',
        status: 'error',
        message: 'Supabase client not available',
        timestamp: new Date(),
      }
    }

    // Test if we can query alerts where this user is in contacts_notified
    // This tests the RLS policy
    const { data, error } = await supabase
      .from('emergency_alerts')
      .select('id, user_id, status, contacts_notified')
      .eq('status', 'active')

    if (error) {
      return {
        name: 'RLS Policy Access',
        status: 'error',
        message: `RLS policy test failed: ${error.message}`,
        details: {
          error: error,
          code: error.code,
          hint: error.hint,
        },
        timestamp: new Date(),
      }
    }

    // Check if any alerts have this user in contacts_notified
    const alertsForUser = data?.filter((alert: any) => {
      if (!alert.contacts_notified || !Array.isArray(alert.contacts_notified)) {
        return false
      }
      return alert.contacts_notified.includes(userId)
    }) || []

    return {
      name: 'RLS Policy Access',
      status: alertsForUser.length > 0 ? 'success' : 'warning',
      message: `RLS policy allows query. Found ${alertsForUser.length} alerts where user is in contacts_notified`,
      details: {
        totalAlerts: data?.length || 0,
        alertsForUser: alertsForUser.length,
        alerts: alertsForUser,
      },
      timestamp: new Date(),
    }
  } catch (error: any) {
    return {
      name: 'RLS Policy Access',
      status: 'error',
      message: `Error testing RLS policy: ${error.message}`,
      details: error,
      timestamp: new Date(),
    }
  }
}

/**
 * Test real-time subscription connection
 */
export async function testRealtimeSubscription(userId: string): Promise<ConnectionTestResult> {
  return new Promise((resolve) => {
    try {
      const supabase = createClient()
      
      if (!supabase) {
        resolve({
          name: 'Real-time Subscription',
          status: 'error',
          message: 'Supabase client not available',
          timestamp: new Date(),
        })
        return
      }

      let subscriptionError: any = null
      let subscriptionStatus: string = 'pending'
      let resolved = false
      let channel: any = null

      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve({
            name: 'Real-time Subscription',
            status: subscriptionStatus === 'SUBSCRIBED' ? 'success' : 'warning',
            message: `Subscription test completed. Final status: ${subscriptionStatus}`,
            details: {
              status: subscriptionStatus,
              error: subscriptionError,
              note: 'Test timed out - connection may still be establishing',
            },
            timestamp: new Date(),
          })
          if (channel) {
            supabase.removeChannel(channel)
          }
        }
      }, 5000)

      channel = supabase
        .channel(`test-connection-${userId}`)
        .on(
          'postgres_changes' as any,
          {
            event: '*',
            schema: 'public',
            table: 'emergency_alerts',
          },
          (payload: any) => {
            console.log('[Diagnostics] Real-time event received:', payload)
          }
        )
        .subscribe((status: any, err?: any) => {
          subscriptionStatus = status
          if (err) {
            subscriptionError = err
          }
          
          if (status === 'SUBSCRIBED') {
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              resolve({
                name: 'Real-time Subscription',
                status: 'success',
                message: `Subscription connected successfully. Status: ${status}`,
                details: {
                  status,
                  channel: `test-connection-${userId}`,
                },
                timestamp: new Date(),
              })
              // Clean up after a short delay
              setTimeout(() => supabase.removeChannel(channel), 1000)
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (!resolved) {
              resolved = true
              clearTimeout(timeout)
              resolve({
                name: 'Real-time Subscription',
                status: 'error',
                message: `Subscription failed. Status: ${status}`,
                details: {
                  status,
                  error: subscriptionError,
                },
                timestamp: new Date(),
              })
              supabase.removeChannel(channel)
            }
          }
        })
    } catch (error: any) {
      resolve({
        name: 'Real-time Subscription',
        status: 'error',
        message: `Error setting up subscription: ${error.message}`,
        details: error,
        timestamp: new Date(),
      })
    }
  })
}

/**
 * Test push notification endpoint
 */
export async function testPushNotificationEndpoint(userId: string): Promise<ConnectionTestResult> {
  try {
    const response = await fetch('/api/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        alertId: 'test-alert-id',
        title: 'Test Push Notification',
        body: 'This is a test',
      }),
    })

    const result = await response.json()

    if (!response.ok && response.status !== 200) {
      return {
        name: 'Push Notification Endpoint',
        status: 'error',
        message: `Push endpoint returned error: ${response.status}`,
        details: result,
        timestamp: new Date(),
      }
    }

    // Push endpoint may return success: false if user doesn't have push enabled
    // This is OK - it means the endpoint is working
    return {
      name: 'Push Notification Endpoint',
      status: result.success ? 'success' : 'warning',
      message: result.success 
        ? 'Push notification endpoint is working'
        : result.message || 'Push endpoint accessible but user may not have push enabled',
      details: result,
      timestamp: new Date(),
    }
  } catch (error: any) {
    return {
      name: 'Push Notification Endpoint',
      status: 'error',
      message: `Error testing push endpoint: ${error.message}`,
      details: error,
      timestamp: new Date(),
    }
  }
}

/**
 * Test contact relationships
 */
export async function testContactRelationships(userId: string): Promise<ConnectionTestResult> {
  try {
    const supabase = createClient()
    
    if (!supabase) {
      return {
        name: 'Contact Relationships',
        status: 'error',
        message: 'Supabase client not available',
        timestamp: new Date(),
      }
    }

    // Get user's contacts
    const { data: contacts, error } = await supabase
      .from('emergency_contacts')
      .select('id, contact_user_id, verified, email')
      .eq('user_id', userId)
      .eq('verified', true)

    if (error) {
      return {
        name: 'Contact Relationships',
        status: 'error',
        message: `Failed to query contacts: ${error.message}`,
        details: error,
        timestamp: new Date(),
      }
    }

    const verifiedContacts = contacts?.filter(c => c.contact_user_id) || []

    return {
      name: 'Contact Relationships',
      status: verifiedContacts.length > 0 ? 'success' : 'warning',
      message: `Found ${verifiedContacts.length} verified contacts with linked user IDs`,
      details: {
        totalContacts: contacts?.length || 0,
        verifiedContacts: verifiedContacts.length,
        contacts: verifiedContacts,
      },
      timestamp: new Date(),
    }
  } catch (error: any) {
    return {
      name: 'Contact Relationships',
      status: 'error',
      message: `Error testing contacts: ${error.message}`,
      details: error,
      timestamp: new Date(),
    }
  }
}

/**
 * Run all connection tests
 */
export async function runAllConnectionTests(userId: string): Promise<ConnectionTestResults> {
  const tests: ConnectionTestResult[] = []

  // Test 1: Supabase client
  tests.push(await testSupabaseClient())

  // Test 2: Database access
  tests.push(await testDatabaseAccess(userId))

  // Test 3: RLS policy
  tests.push(await testRLSPolicyAccess(userId))

  // Test 4: Real-time subscription
  tests.push(await testRealtimeSubscription(userId))

  // Test 5: Push notification endpoint
  tests.push(await testPushNotificationEndpoint(userId))

  // Test 6: Contact relationships
  tests.push(await testContactRelationships(userId))

  // Determine overall status
  const hasErrors = tests.some(t => t.status === 'error')
  const hasWarnings = tests.some(t => t.status === 'warning')
  const overallStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'success'

  return {
    tests,
    overallStatus,
  }
}

