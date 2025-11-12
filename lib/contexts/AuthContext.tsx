'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { User } from '@supabase/supabase-js'
import { createClient } from '../supabase'
import { UserProfile } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName?: string, phone?: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = useMemo(() => {
    try {
      // Only initialize Supabase on the client side
      if (typeof window === 'undefined') {
        return undefined
      }
      
      // Check if required environment variables are available
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      
      if (!supabaseUrl || !supabaseAnonKey) {
        console.error('[Auth] Missing Supabase environment variables:', {
          hasUrl: !!supabaseUrl,
          hasKey: !!supabaseAnonKey
        })
        return undefined
      }
      
      return createClient()
    } catch (error) {
      console.error('[Auth] Failed to initialize Supabase client:', error)
      return undefined
    }
  }, [])

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    if (!supabase) return null
    
    // Wrap in timeout to prevent hanging - truly non-blocking
    const fetchPromise = (async () => {
      try {
        // Check if we have a valid session first
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session || session.user.id !== userId) {
          // No valid session - can't fetch profile due to RLS
          return null
        }
        
        // Use .maybeSingle() instead of .single() to handle cases where profile doesn't exist
        // .maybeSingle() returns null when no rows found instead of throwing 406 error
        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle()

        // Handle 406 errors explicitly (shouldn't happen with .maybeSingle() but good to be safe)
        if (error) {
          // 406 or PGRST116 means profile doesn't exist - not an error
          if (error.code === 'PGRST116' || error.status === 406 || error.message.includes('406')) {
            console.warn('Profile does not exist yet for user:', userId)
            return null
          }
          // Other errors - log but don't throw
          console.warn('Error fetching profile:', error)
          return null
        }

        return data as UserProfile | null
      } catch (error: any) {
        // Handle 406 errors in catch block as well
        if (error?.status === 406 || error?.message?.includes('406')) {
          console.warn('Profile fetch returned 406 - profile does not exist yet')
          return null
        }
        console.error('Error fetching profile:', error)
        return null
      }
    })()

    // Add 5s timeout - never throw, always return null on timeout
    // Reduced from 10s to prevent hanging
    const timeoutPromise = new Promise<UserProfile | null>((resolve) => {
      setTimeout(() => {
        // Only log warning in development to reduce noise
        if (process.env.NODE_ENV === 'development') {
          console.warn('Profile fetch timed out after 5s - returning null')
        }
        resolve(null)
      }, 5000)
    })

    try {
      return await Promise.race([fetchPromise, timeoutPromise])
    } catch (error: any) {
      // Never throw errors from fetchProfile - always return null
      console.error('Unexpected error in fetchProfile:', error)
      return null
    }
  }, [supabase])

  useEffect(() => {
    if (!supabase) {
      console.warn('[Auth] Supabase client not available - setting loading to false')
      setLoading(false)
      setUser(null)
      setProfile(null)
      return
    }

    // Log client initialization for debugging
    const isMobile = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    console.log('[Auth] Initializing auth state listener:', {
      hasClient: !!supabase,
      hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      urlPrefix: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30) || 'missing',
      isMobile,
      userAgent: typeof window !== 'undefined' ? navigator.userAgent : 'server',
      cookieEnabled: typeof navigator !== 'undefined' ? navigator.cookieEnabled : false,
      hasLocalStorage: typeof Storage !== 'undefined'
    })

    let mounted = true
    let initialTimeoutId: NodeJS.Timeout | null = null
    let hasReceivedAuthEvent = false
    let hasCheckedInitialSession = false

    // Helper function to update auth state
    const updateAuthState = async (session: { user: User | null } | null, event?: string) => {
      if (!mounted) return
      
      console.log('[Auth] Updating auth state:', { 
        event, 
        hasUser: !!session?.user, 
        userId: session?.user?.id 
      })
      
      // Single source of truth for user state
      setUser(session?.user ?? null)
      
      if (session?.user && session) {
        // Fetch profile in background - truly non-blocking (has timeout wrapper)
        // Never throws errors, always returns null on failure
        fetchProfile(session.user.id)
          .then((userProfile) => {
            if (mounted) setProfile(userProfile)
          })
          // fetchProfile never throws, but add catch for safety
          .catch(() => {
            if (mounted) setProfile(null)
          })
      } else {
        setProfile(null)
      }
      
      // Single source of truth for loading state - set here only
      setLoading(false)
    }

    // Single timeout for initial auth state (10 seconds absolute failsafe)
    // This ensures we don't hang forever if auth state change never fires
    initialTimeoutId = setTimeout(() => {
      if (mounted && !hasReceivedAuthEvent) {
        console.warn('[Auth] Initial auth state timeout (10s) - setting loading to false')
        setLoading(false)
        // Don't set user/profile - let onAuthStateChange handle it when it fires
      }
    }, 10000)

    // Check initial session immediately (don't wait for onAuthStateChange)
    // This ensures we get the session right away if it exists
    const checkInitialSession = async () => {
      if (hasCheckedInitialSession) return
      hasCheckedInitialSession = true
      
      try {
        console.log('[Auth] Checking initial session...')
        
        // Add timeout wrapper to prevent hanging (getSession can hang on network issues)
        // Shorter timeout on mobile for faster feedback
        const isMobile = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        const timeoutMs = isMobile ? 5000 : 10000 // 5s mobile, 10s desktop
        
        const sessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise<{ data: { session: null }, error: { message: string } }>((resolve) => {
          setTimeout(() => {
            console.warn(`[Auth] ⏱️ Session check timed out after ${timeoutMs}ms (${isMobile ? 'mobile' : 'desktop'})`)
            resolve({ 
              data: { session: null }, 
              error: { message: `Session check timed out after ${timeoutMs}ms` } 
            })
          }, timeoutMs)
        })
        
        const sessionResult: any = await Promise.race([sessionPromise, timeoutPromise])
        const { data: { session }, error } = sessionResult
        
        if (!mounted) return
        
        if (error) {
          console.warn('[Auth] Error getting initial session:', error)
          // Set loading to false on error/timeout so user can proceed
          // onAuthStateChange will handle it if session exists
          setLoading(false)
          return
        }
        
        if (session) {
          console.log('[Auth] ✅ Initial session found:', { userId: session.user?.id, email: session.user?.email })
          // Clear timeout since we have a session
          if (initialTimeoutId) {
            clearTimeout(initialTimeoutId)
            initialTimeoutId = null
          }
          hasReceivedAuthEvent = true
          await updateAuthState(session, 'INITIAL_SESSION')
        } else {
          console.log('[Auth] No initial session found')
          // Set loading to false if no session - user is not logged in
          setLoading(false)
        }
      } catch (error) {
        console.error('[Auth] Error checking initial session:', error)
        if (mounted) {
          setLoading(false)
        }
      }
    }

    // Check initial session immediately
    checkInitialSession()

    // Single source of truth: onAuthStateChange listener
    // This fires immediately with current session and on any auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event: string, session: { user: User | null } | null) => {
      if (!mounted) return
      
      console.log('[Auth] onAuthStateChange event:', { event, hasUser: !!session?.user })
      
      // Clear initial timeout once we receive first auth event
      if (!hasReceivedAuthEvent && initialTimeoutId) {
        clearTimeout(initialTimeoutId)
        initialTimeoutId = null
        hasReceivedAuthEvent = true
      }
      
      try {
        await updateAuthState(session, event)
      } catch (error) {
        console.error('[Auth] Error in auth state change handler:', error)
        if (mounted) {
          setLoading(false)
        }
      }
    })

    return () => {
      mounted = false
      if (initialTimeoutId) {
        clearTimeout(initialTimeoutId)
      }
      subscription.unsubscribe()
    }
  }, [supabase, fetchProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      throw new Error('Supabase client not initialized')
    }

    // Check if environment variables are set (prevent using invalid client)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('placeholder') || supabaseAnonKey.includes('placeholder')) {
      console.error('Supabase environment variables missing or invalid')
      throw new Error('Server configuration error. Please check your Supabase settings.')
    }
    
    try {
      console.log('Starting sign-in...', { email: email.trim(), hasUrl: !!supabaseUrl, hasKey: !!supabaseAnonKey })
      
      // Add timeout wrapper to prevent indefinite hanging on slow/poor networks
      // Mobile networks can be slow, so 20 seconds is reasonable
      const signInPromise = supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Sign-in request timed out. Please check your internet connection and try again.'))
        }, 20000) // 20 second timeout
      })
      
      // Race between sign-in and timeout
      // If timeout wins, we get a timeout error
      // If sign-in wins, we get the sign-in result
      const signInResult: any = await Promise.race([signInPromise, timeoutPromise])
      
      const { data, error } = signInResult
      
      console.log('Sign-in response received')

      if (error) {
        console.error('Sign-in error:', error)
        // Provide user-friendly error messages
        if (error.message.includes('Invalid login credentials') || error.message.includes('Email not confirmed')) {
          throw new Error('Invalid email or password. Please check your credentials and try again.')
        }
        if (error.message.includes('fetch') || error.message.includes('network')) {
          throw new Error('Network error. Please check your internet connection and try again.')
        }
        throw new Error(error.message || 'Failed to sign in')
      }

      if (!data?.user) {
        console.error('Sign-in failed: No user data')
        throw new Error('Failed to sign in. Please try again.')
      }

      console.log('Sign-in successful - refreshing session')
      
      // Explicitly refresh session to ensure it's immediately available
      // Add timeout to prevent hanging on session refresh (non-critical)
      try {
        const sessionPromise = supabase.auth.getSession()
        const sessionTimeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Session refresh timed out'))
          }, 5000) // 5 second timeout for session refresh
        })
        
        try {
          const sessionResult: any = await Promise.race([sessionPromise, sessionTimeoutPromise])
          const { data: { session: refreshedSession }, error: refreshError } = sessionResult
          
          if (!refreshError && refreshedSession) {
            console.log('Session refreshed successfully')
            // Session is now confirmed - onAuthStateChange will fire and update state
          } else {
            console.warn('Session refresh returned error, but sign-in succeeded:', refreshError)
            // Continue anyway - onAuthStateChange will handle it
          }
        } catch (sessionTimeoutError: any) {
          // Session refresh timeout - log but don't fail sign-in
          // This is non-critical - onAuthStateChange will handle state updates
          console.warn('Session refresh timed out (non-critical):', sessionTimeoutError)
          // Continue - onAuthStateChange will handle it
        }
      } catch (refreshErr) {
        console.warn('Error refreshing session (non-critical):', refreshErr)
        // Continue anyway - onAuthStateChange will handle it
      }
      
      // Don't wait here - let the login page wait for actual state update via useEffect
      // This ensures we wait for the actual auth state change, not just a fixed delay
      console.log('Sign-in complete - onAuthStateChange will update state')
    } catch (err: any) {
      console.error('Sign-in failed:', err)
      // Don't manipulate state here - only throw errors
      // onAuthStateChange will handle state updates
      const error = err instanceof Error ? err : new Error(err?.message || 'Failed to sign in')
      throw error
    }
  }, [supabase])

  const signUp = useCallback(async (email: string, password: string, fullName?: string, phone?: string) => {
    if (!supabase) {
      const error = new Error('Supabase client not initialized')
      console.error('signUp error:', error)
      throw error
    }
    
    try {
      // Email verification is disabled - users can login immediately after signup
      const signUpOptions: any = {
        data: {},
      }
      
      // Add user metadata
      if (fullName) signUpOptions.data.full_name = fullName
      if (phone) signUpOptions.data.phone = phone
      
      // Call signUp - this is the only blocking operation
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: signUpOptions,
      })

      if (error) {
        console.error('Supabase signUp error:', error)
        // Provide user-friendly error messages
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          throw new Error('This email is already registered. Please sign in instead.')
        }
        if (error.message.includes('Invalid email')) {
          throw new Error('Invalid email address. Please check and try again.')
        }
        if (error.message.includes('password')) {
          throw new Error('Password does not meet requirements. Please use a stronger password.')
        }
        throw new Error(error.message ?? 'Failed to create account')
      }

      if (!data.user) {
        throw new Error('User account was not created. Please try again.')
      }

      // Create profile immediately after successful signup
      // This ensures profile exists when onAuthStateChange fires
      try {
        const userEmail = data.user.email
        if (userEmail) {
          const { error: createError } = await supabase
            .from('user_profiles')
            .insert({
              id: data.user.id,
              email: userEmail,
              full_name: fullName || null,
              phone: phone || null,
            })

          if (createError) {
            console.warn('Failed to create profile during signup:', createError)
            // Don't throw - profile creation is non-critical, can be created later
          } else {
            console.log('Profile created during signup')
          }
        }
      } catch (profileErr) {
        console.warn('Error creating profile during signup:', profileErr)
        // Don't throw - profile can be created by onAuthStateChange listener
      }

      // Don't set user state here - let onAuthStateChange handle it
      // This ensures single source of truth and prevents race conditions
      console.log('Sign-up successful - onAuthStateChange will set user state')
    } catch (err: any) {
      console.error('Sign-up failed:', err)
      // Don't manipulate state here - only throw errors
      // onAuthStateChange will handle state updates
      const error = err instanceof Error ? err : new Error(err?.message || err?.toString() || 'Failed to create account')
      throw error
    }
  }, [supabase])

  const signOut = useCallback(async () => {
    if (!supabase) return
    
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [supabase])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    
    const userProfile = await fetchProfile(user.id)
    setProfile(userProfile)
  }, [user, fetchProfile])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

