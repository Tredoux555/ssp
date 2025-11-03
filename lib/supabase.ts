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
    // Return a mock client to prevent crashes during development
    // Only on client-side - this check ensures we're not on server
    return createBrowserClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseAnonKey || 'placeholder-key'
    )
  }

  try {
    return createBrowserClient(supabaseUrl, supabaseAnonKey)
  } catch (error) {
    console.error('Failed to create Supabase client:', error)
    // Return mock client as fallback instead of throwing
    return createBrowserClient(
      'https://placeholder.supabase.co',
      'placeholder-key'
    )
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

