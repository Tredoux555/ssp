import { createBrowserClient } from '@supabase/ssr'

// Client-side Supabase client
export const createClient = () => {
  // Never run on server-side - return undefined instead of throwing
  if (typeof window === 'undefined') {
    return undefined as any
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables')
    console.error('Please check your .env.local file for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
    // Return undefined instead of mock client - this will cause proper error handling
    return undefined as any
  }

  try {
    const client = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10, // Limit events per second
        },
        // Configure heartbeat for connection health
        heartbeatIntervalMs: 30000, // 30 seconds
        reconnectAfterMs: (tries: number) => {
          // Exponential backoff: 1s, 2s, 5s, 10s, 30s
          const delays = [1000, 2000, 5000, 10000, 30000]
          return delays[Math.min(tries, delays.length - 1)] || 30000
        },
      },
    })
    
    return client
  } catch (error) {
    console.error('Failed to create Supabase client:', error)
    // Return undefined instead of mock client - prevents hanging on non-existent server
    return undefined as any
  }
}

// Admin client for server-side operations
export const createAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Supabase URL is missing. Please check NEXT_PUBLIC_SUPABASE_URL environment variable.')
  }

  if (!serviceKey) {
    throw new Error('Service role key is missing. Please check SUPABASE_SERVICE_ROLE_KEY environment variable.')
  }

  return createBrowserClient(supabaseUrl, serviceKey)
}

