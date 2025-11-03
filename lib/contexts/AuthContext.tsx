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
      return createClient()
    } catch (error) {
      console.error('Failed to initialize Supabase client:', error)
      return undefined
    }
  }, [])

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) return null
    
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
  }, [supabase])

  useEffect(() => {
    if (!supabase) {
      console.warn('Supabase client not available - setting loading to false')
      setLoading(false)
      setUser(null)
      setProfile(null)
      return
    }

    let mounted = true
    let timeoutId: NodeJS.Timeout | null = null
    let failsafeTimeout: NodeJS.Timeout | null = null

    // Very aggressive timeout for mobile (2 seconds) - multiple fallbacks
    timeoutId = setTimeout(() => {
      if (mounted) {
        console.warn('Session fetch timed out (2s), proceeding without user')
        setLoading(false)
        // Don't set user/profile to null on timeout - let the auth listener handle it
        // This prevents race conditions where timeout fires but session succeeds
      }
    }, 2000) // Very aggressive 2 seconds for mobile

    // Additional fallback timeout at 5 seconds (absolute failsafe)
    failsafeTimeout = setTimeout(() => {
      if (mounted) {
        console.warn('Session fetch absolute failsafe timeout (5s)')
        setLoading(false)
        setUser(null)
        setProfile(null)
      }
    }, 5000)

    supabase.auth.getSession()
      .then((response: { data: { session: any } | null; error: any }) => {
        const session = response.data?.session
        const sessionError = response.error
        if (!mounted) return
        
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        if (failsafeTimeout) {
          clearTimeout(failsafeTimeout)
        }
        
        if (sessionError) {
          console.error('Error getting session:', sessionError)
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }
        
        setUser(session?.user ?? null)
        // IMPORTANT: Don't wait for profile fetch - set loading to false immediately
        // Profile fetch should be non-blocking and happen in the background
        setLoading(false)
        
        if (session?.user && session) {
          // Fetch profile in background - don't block loading state
          // This is critical for mobile where network might be slow
          fetchProfile(session.user.id)
            .then((profile) => {
              if (mounted) setProfile(profile)
            })
            .catch((profileError) => {
              // Handle 406 gracefully - it means profile doesn't exist yet
              if (profileError?.status === 406 || profileError?.message?.includes('406')) {
                console.warn('Profile does not exist yet - will be created on first sign-in')
              } else {
                console.error('Error fetching profile:', profileError)
              }
              if (mounted) setProfile(null)
            })
        } else {
          setProfile(null)
        }
      })
      .catch((error: unknown) => {
        console.error('Exception getting session:', error)
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        if (failsafeTimeout) {
          clearTimeout(failsafeTimeout)
        }
        if (mounted) {
          setUser(null)
          setProfile(null)
          setLoading(false)
        }
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event: string, session: { user: User | null } | null) => {
      if (!mounted) return
      
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      
      try {
        setUser(session?.user ?? null)
        if (session?.user && session) {
          // Only fetch profile if we have a valid session
          try {
            const userProfile = await fetchProfile(session.user.id)
            if (mounted) setProfile(userProfile)
            
            // If profile doesn't exist and this is a SIGNED_IN event, try to create it
            if (!userProfile && event === 'SIGNED_IN') {
              try {
                const userEmail = session.user.email
                if (userEmail) {
                  const { error: createError } = await supabase
                    .from('user_profiles')
                    .insert({
                      id: session.user.id,
                      email: userEmail,
                      full_name: null,
                      phone: null,
                    })

                  if (!createError) {
                    // Profile created - fetch it
                    const newProfile = await fetchProfile(session.user.id)
                    if (mounted && newProfile) {
                      setProfile(newProfile)
                    }
                  } else {
                    console.warn('Failed to create profile in auth listener:', createError)
                    if (mounted) setProfile(null)
                  }
                }
              } catch (createErr) {
                console.error('Error creating profile in auth listener:', createErr)
                if (mounted) setProfile(null)
              }
            }
          } catch (profileError: any) {
            // Handle 406 gracefully - it means profile doesn't exist yet
            if (profileError?.status === 406 || profileError?.message?.includes('406')) {
              console.warn('Profile does not exist yet in auth state change')
              if (mounted) setProfile(null)
            } else {
              console.error('Error fetching profile in auth state change:', profileError)
              if (mounted) setProfile(null)
            }
          }
        } else {
          setProfile(null)
        }
        setLoading(false)
      } catch (error) {
        console.error('Error in auth state change handler:', error)
        if (mounted) {
          setLoading(false)
        }
      }
    })

    return () => {
      mounted = false
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (failsafeTimeout) {
        clearTimeout(failsafeTimeout)
      }
      subscription.unsubscribe()
    }
  }, [supabase, fetchProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      throw new Error('Supabase client not initialized')
    }
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        // Provide user-friendly error messages
        if (error.message.includes('Invalid login credentials') || error.message.includes('Email not confirmed')) {
          throw new Error('Invalid email or password. Please check your credentials and try again.')
        }
        throw new Error(error.message || 'Failed to sign in')
      }

      if (!data.user) {
        throw new Error('Failed to sign in. Please try again.')
      }

      // Fetch and set profile
      try {
        const userProfile = await fetchProfile(data.user.id)
        setProfile(userProfile)
      } catch (fetchError) {
        console.warn('Failed to fetch profile after sign in:', fetchError)
        // Don't fail sign in if profile fetch fails - it will be loaded by auth state listener
        setProfile(null)
      }

      // Ensure user state is updated
      setUser(data.user)
    } catch (err: any) {
      console.error('Sign-in failed:', err)
      // Ensure we don't leave the app in a broken state
      setUser(null)
      setProfile(null)
      // Rethrow with proper error message
      const error = err instanceof Error ? err : new Error(err?.message || 'Failed to sign in')
      throw error
    }
  }, [supabase, fetchProfile])

  const signUp = useCallback(async (email: string, password: string, fullName?: string, phone?: string) => {
    if (!supabase) {
      const error = new Error('Supabase client not initialized')
      console.error('signUp error:', error)
      throw error
    }
    
    // Simplest possible signup - just create the account and set user state
    // Don't wait for session or profile - let auth listener handle everything
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

      // Set user state immediately - this allows UI to update right away
      // Auth listener will handle session and profile creation
      setUser(data.user)
      setProfile(null) // Will be set by auth listener

      // Success - return immediately
      // Profile and session will be handled by onAuthStateChange listener
    } catch (err: any) {
      console.error('Sign-up failed:', err)
      // Ensure we don't leave the app in a broken state
      setUser(null)
      setProfile(null)
      // Create a proper error object if it's not already one
      const error = err instanceof Error ? err : new Error(err?.message || err?.toString() || 'Failed to create account')
      // Rethrow so UI can display the message
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

