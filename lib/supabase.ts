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
      cookies: {
        get(name: string) {
          // Get cookie from document.cookie - enhanced for mobile reliability
          if (typeof document === 'undefined') return undefined
          
          const value = `; ${document.cookie}`
          const parts = value.split(`; ${name}=`)
          if (parts.length === 2) {
            const cookieValue = parts.pop()?.split(';').shift()
            // Only log main auth token cookie reads (not chunked cookies which are expected to not exist)
            if (cookieValue && name.includes('auth-token') && !name.includes('auth-token.') && !name.includes('code-verifier')) {
              console.log('[DIAG] [Supabase] ✅ Cookie read:', { name, hasValue: true, length: cookieValue.length })
            }
            return cookieValue
          }
          
          // Only log missing cookies if they're critical (main auth token), not chunked cookies
          if (name.includes('auth-token') && !name.includes('auth-token.') && !name.includes('code-verifier')) {
            console.warn('[DIAG] [Supabase] ⚠️ Critical cookie not found:', { name, allCookies: document.cookie.substring(0, 100) })
          }
          return undefined
        },
        set(name: string, value: string, options: any) {
          // Set cookie with proper options for session persistence
          // Respect Supabase's sameSite option if provided, otherwise use lax
          const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
          const sameSite = options?.sameSite || 'lax'
          
          // CRITICAL: samesite=none REQUIRES secure flag
          // If Supabase requests none but we're not on HTTPS, fall back to lax
          const finalSameSite = (sameSite === 'none' && !isSecure) ? 'lax' : sameSite
          const needsSecure = finalSameSite === 'none' || isSecure
          
          const cookieOptions = [
            `${name}=${value}`,
            'path=/',
            options?.maxAge ? `max-age=${options.maxAge}` : 'max-age=31536000', // 1 year default
            needsSecure ? 'secure' : '',
            `samesite=${finalSameSite}`,
          ].filter(Boolean).join('; ')
          
          // Only log main auth token cookie sets (reduce noise)
          if (name.includes('auth-token') && !name.includes('auth-token.') && !name.includes('code-verifier')) {
            console.log('[DIAG] [Supabase] Setting cookie:', {
              name,
              hasValue: !!value,
              sameSite: finalSameSite,
              secure: needsSecure,
              isHTTPS: isSecure
            })
          }
          
          document.cookie = cookieOptions
          
          // Verify cookie was set (critical for mobile)
          setTimeout(() => {
            const verifyCookie = document.cookie.split('; ').find(row => row.startsWith(`${name}=`))
            if (!verifyCookie && value) {
              console.warn('[DIAG] [Supabase] ⚠️ Cookie may not have been set:', {
                name,
                cookieEnabled: navigator.cookieEnabled,
                timestamp: new Date().toISOString()
              })
            }
          }, 50)
        },
        remove(name: string, options: any) {
          // Remove cookie
          document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;`
        },
      },
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

