'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { getActiveEmergency, getEmergencyContacts } from '@/lib/emergency'
import { getCurrentLocation, reverseGeocode } from '@/lib/location'
import { subscribeToContactAlerts } from '@/lib/realtime/subscriptions'
import { showEmergencyAlert, hideEmergencyAlert } from '@/lib/notifications'
import { registerDeviceForPush } from '@/lib/services/push'
import { createClient } from '@/lib/supabase'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { AlertTriangle, Users, Phone, MapPin, LogOut, Bell, BellOff } from 'lucide-react'
import { EmergencyAlert } from '@/types/database'

// Helper function to properly serialize errors for logging
function serializeError(error: any): any {
  if (!error) return null
  
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      constructor: error.constructor?.name,
    }
  }
  
  if (typeof error === 'string') {
    return { message: error }
  }
  
  // Try to extract any properties
  try {
    const keys = Object.keys(error || {})
    if (keys.length > 0) {
      return error
    }
  } catch {
    // Object.keys might fail for some error types
  }
  
  return { message: String(error), type: typeof error }
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, profile, signOut, loading: authLoading } = useAuth()
  const [activeEmergency, setActiveEmergency] = useState<EmergencyAlert | null>(null)
  const [emergencyLoading, setEmergencyLoading] = useState(false)
  const [contactCount, setContactCount] = useState(0)
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null)
  const activeEmergencyRef = useRef<EmergencyAlert | null>(null)
  const senderInfoCacheRef = useRef<Map<string, { data: { name: string | null; email: string | null }; timestamp: number }>>(new Map())
  const contactCountCacheRef = useRef<{ count: number; timestamp: number } | null>(null)
  const isMountedRef = useRef(true)
  
  // Keep ref in sync with state
  useEffect(() => {
    activeEmergencyRef.current = activeEmergency
  }, [activeEmergency])

  // Track mount state
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const loadActiveEmergency = useCallback(async () => {
    if (!user) return

    try {
      // Add a small delay to allow cancelled alerts to process
      // This prevents race conditions where cancellation hasn't fully processed yet
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const emergency = await getActiveEmergency(user.id)
      
      // Strict validation: Only set activeEmergency if emergency exists AND is actually active
      // Also verify it belongs to the current user
      if (emergency && emergency.status === 'active' && emergency.user_id === user.id && emergency.id) {
        console.log('[Dashboard] ✅ Valid active emergency found:', {
          id: emergency.id,
          status: emergency.status,
          userId: emergency.user_id,
          triggeredAt: emergency.triggered_at
        })
        setActiveEmergency(emergency)
        
        // Only auto-redirect if we have a confirmed active emergency
        // Don't redirect if we just came from cancelling an alert or an error state
        const currentPath = window.location.pathname
        const isOnEmergencyPage = currentPath.includes(`/emergency/active/${emergency.id}`)
        const hasErrorState = sessionStorage.getItem('emergency-error-state') === 'true'
        
        // Don't redirect if:
        // 1. Already on emergency page
        // 2. Coming from error state (prevents redirect loop)
        // 3. User explicitly navigated away (check referrer)
        if (!isOnEmergencyPage && !hasErrorState) {
          // Check if we came from emergency page (user might have navigated away intentionally)
          const referrer = document.referrer
          const cameFromEmergency = referrer.includes(`/emergency/active/${emergency.id}`)
          
          // Only redirect if we didn't come from the emergency page
          // This prevents loops when user navigates away from error
          if (!cameFromEmergency) {
            router.push(`/emergency/active/${emergency.id}`)
          }
        }
      } else {
        // No valid active emergency - clear state
        if (emergency) {
          console.warn('[Dashboard] ⚠️ Found emergency but it\'s not valid:', {
            id: emergency.id,
            status: emergency.status,
            userId: emergency.user_id,
            currentUserId: user.id,
            reason: !emergency.id ? 'missing id' : 
                    emergency.status !== 'active' ? `status is ${emergency.status}` :
                    emergency.user_id !== user.id ? 'user mismatch' : 'unknown'
          })
        } else {
          console.log('[Dashboard] ℹ️ No active emergency found')
        }
        setActiveEmergency(null)
      }
    } catch (error: any) {
      console.error('[Dashboard] ❌ Failed to load active emergency:', error)
      // Don't show error to user - just log it
      // Emergency might not exist, which is fine
      setActiveEmergency(null)
    }
  }, [user, router])

  const loadContactCount = useCallback(async () => {
    if (!user) return

    try {
      const contacts = await getEmergencyContacts(user.id)
      setContactCount(contacts.length || 0)
    } catch (error: any) {
      console.error('Failed to load contacts:', error)
      // Set to 0 on error so UI doesn't break
      setContactCount(0)
    }
  }, [user])

  useEffect(() => {
    // Wait for auth loading to complete before checking user
    // This prevents premature redirects before auth state is ready
    if (authLoading) {
      return // Still loading, wait
    }
    
    // Only redirect if auth loading is complete and no user
    if (!user) {
      // Longer delay on mobile to prevent redirect loops
      // Mobile networks may be slower to update auth state
      const delay = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? 1000 : 500
      const redirectTimeout = setTimeout(() => {
        // Double-check user is still not set before redirecting
        // This prevents redirect loops if user state updates during delay
        if (!user) {
          router.push('/auth/login')
        }
      }, delay)
      
      return () => clearTimeout(redirectTimeout)
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (!user) return
    
    // Connection health check
    const checkConnection = async () => {
      const supabase = createClient()
      if (!supabase) {
        console.error('[Dashboard] ❌ Supabase client not available')
        return false
      }
      
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session) {
        console.error('[Dashboard] ❌ No active session:', sessionError)
        return false
      }
      
      console.log('[Dashboard] ✅ Connection check passed:', {
        userId: session.user.id,
        email: session.user.email
      })
      return true
    }
    
    checkConnection()
    
    // Only run once per user - use user.id as the key to prevent re-running
    const userId = user.id
    
    // In development, add guard against rapid re-setup (Fast Refresh issue)
    if (process.env.NODE_ENV === 'development') {
      const setupKey = `dashboard-setup-${userId}`
      const lastSetup = (window as any).__lastDashboardSetup?.[setupKey]
      const now = Date.now()
      
      // If setup happened in last 2 seconds, skip (likely Fast Refresh)
      if (lastSetup && now - lastSetup < 2000) {
        console.log(`[Dashboard] Skipping rapid re-setup for user ${userId} (likely Fast Refresh)`)
        return
      }
      
      if (!(window as any).__lastDashboardSetup) {
        (window as any).__lastDashboardSetup = {}
      }
      (window as any).__lastDashboardSetup[setupKey] = now
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Dashboard] Setting up subscription for user: ${userId}`)
    }
    
    // Call these functions directly - they're stable useCallback functions
    // Use setTimeout to defer these calls and prevent blocking the effect
    setTimeout(() => {
      loadActiveEmergency()
      loadContactCount()
    }, 0)
      
      let subscriptionActive = false
      let pollingInterval: NodeJS.Timeout | null = null
    let isPollingActive = false
    let isPageVisible = true
    let isNetworkOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
    let debounceTimeout: NodeJS.Timeout | null = null
    let isMounted = true
      
      // Subscribe to emergency alerts for this contact user
      // This fires when someone in their contact list triggers an alert
      console.log(`[Dashboard] 🔔 Setting up contact alert subscription for user: ${userId}`)
      const unsubscribe = subscribeToContactAlerts(userId, async (alert) => {
        console.log(`[Dashboard] 📬 Subscription callback triggered for user ${userId}:`, {
          alertId: alert?.id,
          alertUserId: alert?.user_id,
          alertStatus: alert?.status,
          contactsNotified: alert?.contacts_notified,
          isMounted,
          currentPath: window.location.pathname
        })
        
        if (!isMounted) {
          console.log(`[Dashboard] ⏭️ Component unmounted, skipping alert`)
          return // Prevent navigation if component unmounted
        }
        
        // Skip if user is the sender (shouldn't happen due to subscription filter, but double-check)
        if (alert.user_id === userId) {
          console.log(`[Dashboard] ⏭️ Skipping alert - user is the sender`)
          return
        }
        
        // Fetch sender information (email/name) from the alert
        let senderName: string | null = null
        let senderEmail: string | null = null
        const cacheKey = `${alert.user_id}-${userId}`
        const now = Date.now()
        const cached = senderInfoCacheRef.current.get(cacheKey)
        
        if (cached && (now - cached.timestamp) < 30000) {
          // Use cached data
          senderName = cached.data.name
          senderEmail = cached.data.email
        } else {
          // Fetch fresh data
          try {
            const supabase = createClient()
            
            // First try to get sender info from emergency_contacts (contact's view of sender)
            const { data: senderContact } = await supabase
              .from('emergency_contacts')
              .select('name, email')
              .eq('contact_user_id', alert.user_id)
              .eq('user_id', userId)
              .maybeSingle()
            
            if (senderContact) {
              senderName = senderContact.name || null
              senderEmail = senderContact.email || null
            }
            
            // If not found in contacts, try to get from user_profiles table
            if (!senderName && !senderEmail) {
              const { data: senderProfile } = await supabase
                .from('user_profiles')
                .select('full_name, email')
                .eq('id', alert.user_id)
                .maybeSingle()
              
              if (senderProfile) {
                senderName = senderProfile.full_name || null
                senderEmail = senderProfile.email || null
              }
            }
            
            // Cache the result
            senderInfoCacheRef.current.set(cacheKey, {
              data: { name: senderName, email: senderEmail },
              timestamp: now,
            })
            
            // Log for debugging
            console.log('[Dashboard] Sender info fetched:', { senderName, senderEmail, alertUserId: alert.user_id })
          } catch (err) {
            console.warn('[Dashboard] Could not fetch sender info:', err)
          }
        }
        
        // Check if we're already on this alert page to prevent redirect loops
        const currentPath = window.location.pathname
        if (currentPath.includes(`/alert/${alert.id}`) || currentPath.includes(`/emergency/active/${alert.id}`)) {
          // Already on alert page, just show the alert overlay
          showEmergencyAlert(alert.id, {
            address: alert.address,
            alert_type: alert.alert_type,
            senderName,
            senderEmail,
            user_id: alert.user_id,
            currentUserId: userId,
          })
          return
        }
        
        console.log(`[Dashboard] ✅ Emergency alert received for contact user ${userId}:`, alert)
        subscriptionActive = true // Mark subscription as active when we receive an event
        
        // Show full-screen alert notification with sender info
        showEmergencyAlert(alert.id, {
          address: alert.address,
          alert_type: alert.alert_type,
          senderName,
          senderEmail,
          user_id: alert.user_id,
          currentUserId: userId,
        })
        
        // Navigate to alert page
        router.push(`/alert/${alert.id}`)
      })
      
      // Adaptive polling mechanism - adjusts frequency based on app state
      // Idle: 30 seconds (when no active emergencies)
      // Active: 5 seconds (when there's an active emergency or recent activity)
      
      // Determine polling interval based on active emergency state
      // This function checks the current state each time (using ref to avoid closure issues)
      const getPollingInterval = () => {
        // Check current activeEmergency state dynamically via ref
        // If there's an active emergency, poll more frequently
        const currentEmergency = activeEmergencyRef.current
        if (currentEmergency && currentEmergency.status === 'active') {
          return 10000 // 10 seconds when active
        }
        return 60000 // 60 seconds when idle
      }
      
      const pollForAlerts = async () => {
        // Skip if tab is hidden or offline or polling is stopped
        if (!isPollingActive || !isPageVisible || !isNetworkOnline) {
          return
        }
        
          try {
            // Check if there are any active alerts where this user is in contacts_notified
            const { createClient } = await import('@/lib/supabase')
            const supabase = createClient()
            if (!supabase) {
              console.warn(`[Dashboard] ⚠️ Supabase client not available for polling`)
              return
            }
            
          // Check if user session is valid
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) {
            console.warn(`[Dashboard] ⚠️ No active session for polling`)
            return
          }
          
          // Query alerts - RLS will automatically filter to only alerts where user is in contacts_notified
            console.log(`[Dashboard] 🔍 Polling for alerts for user ${userId}...`)
            const { data: allAlerts, error: queryError } = await supabase
              .from('emergency_alerts')
              .select('*')
              .eq('status', 'active')
              .order('triggered_at', { ascending: false })
            .limit(5)
            
            console.log(`[Dashboard] 📊 Polling result for user ${userId}:`, {
              alertCount: allAlerts?.length || 0,
              alerts: allAlerts?.map((a: any) => ({
                id: a.id,
                userId: a.user_id,
                status: a.status,
                contactsNotified: a.contacts_notified,
                contactsNotifiedLength: Array.isArray(a.contacts_notified) ? a.contacts_notified.length : 'N/A'
              })),
              error: queryError ? {
                code: queryError.code,
                message: queryError.message,
                details: queryError.details,
                hint: queryError.hint
              } : null
            })
            
          // If error is RLS-related (42501) or CORS-related, it means RLS is blocking
          // This is expected if the user has no alerts - don't spam the console
            if (queryError) {
            // Only log if it's not a CORS/RLS error (which is expected when user has no access)
            if (queryError.code !== '42501' && !queryError.message?.includes('row-level security') && !queryError.message?.includes('access control') && !queryError.message?.includes('Load failed')) {
              console.warn(`[Dashboard] ⚠️ Polling query error:`, queryError)
            } else {
              console.log(`[Dashboard] ℹ️ Polling query blocked by RLS (expected if user has no alerts):`, {
                code: queryError.code,
                message: queryError.message
              })
            }
              return
            }
            
            if (allAlerts && allAlerts.length > 0) {
              // Filter client-side: check if user.id is in contacts_notified array
              const relevantAlerts = allAlerts.filter((alert: any) => {
                if (!alert.contacts_notified || !Array.isArray(alert.contacts_notified)) {
                  return false
                }
                
                // Normalize IDs for comparison (trim whitespace, ensure string)
              const normalizedUserId = String(userId).trim()
                const normalizedContacts = alert.contacts_notified.map((id: string) => String(id).trim())
                
              return normalizedContacts.includes(normalizedUserId)
              })
              
              if (relevantAlerts.length > 0) {
                const alert = relevantAlerts[0]
              if (!isMounted) return // Prevent navigation if component unmounted
              
              // Skip if user is the sender
              if (alert.user_id === userId) {
                return
              }
              
              console.log(`[Dashboard] 🚨 POLLING FOUND ALERT FOR USER ${userId}:`, {
                  alertId: alert.id,
                  alertUserId: alert.user_id,
                  contactsNotified: alert.contacts_notified,
                  userIsInContacts: true
                })
              
              // Fetch sender info
              let senderName: string | null = null
              let senderEmail: string | null = null
              try {
                const supabase = createClient()
                
                // First try from emergency_contacts
                const { data: senderContact } = await supabase
                  .from('emergency_contacts')
                  .select('name, email')
                  .eq('contact_user_id', alert.user_id)
                  .eq('user_id', userId)
                  .maybeSingle()
                
                if (senderContact) {
                  senderName = senderContact.name || null
                  senderEmail = senderContact.email || null
                } else {
                  // Fallback to user_profiles
                  const { data: senderProfile } = await supabase
                    .from('user_profiles')
                    .select('full_name, email')
                    .eq('id', alert.user_id)
                    .maybeSingle()
                  
                  if (senderProfile) {
                    senderName = senderProfile.full_name || null
                    senderEmail = senderProfile.email || null
                  }
                }
              } catch (err) {
                console.warn('[Dashboard] Could not fetch sender info in polling:', err)
              }
                
                // Check if we're already on this alert page
                const currentPath = window.location.pathname
                if (!currentPath.includes(`/alert/${alert.id}`) && !currentPath.includes(`/emergency/active/${alert.id}`)) {
                  console.log(`[Dashboard] 🚨 Navigating to alert page via polling: ${alert.id}`)
                  showEmergencyAlert(alert.id, {
                    address: alert.address,
                    alert_type: alert.alert_type,
                  senderName,
                  senderEmail,
                  user_id: alert.user_id,
                  currentUserId: userId,
                  })
                  router.push(`/alert/${alert.id}`)
                }
              }
            }
          } catch (error) {
            console.warn(`[Dashboard] ⚠️ Polling error:`, error)
          }
      }
      
      const startPolling = () => {
        // Already polling - don't start again
        if (pollingInterval) {
          return
        }
        
        // Don't start if tab hidden or offline
        if (!isPageVisible || !isNetworkOnline) {
          return
      }
      
        // Always enable polling as fallback (even in development)
        // Realtime subscriptions can fail, so polling is critical
        console.log(`[Dashboard] 📡 Starting polling (development mode: ${process.env.NODE_ENV === 'development'})`)
        
        isPollingActive = true
        
        // Start with initial poll
        pollForAlerts()
        
        // Set up interval with adaptive interval
        // Use shortest interval (5s) and check state on each cycle
        // This allows immediate adaptation without recursion
        const baseInterval = 5000 // Check every 5 seconds minimum
        
        let lastCheck = Date.now()
        
        pollingInterval = setInterval(() => {
          // Check if polling should continue
          if (!isPollingActive || !isPageVisible || !isNetworkOnline) {
            return
          }
          
          const now = Date.now()
          const timeSinceLastCheck = now - lastCheck
          const desiredInterval = getPollingInterval()
          
          // Only poll if enough time has passed based on desired interval
          if (timeSinceLastCheck >= desiredInterval) {
            lastCheck = now
            pollForAlerts()
          }
        }, baseInterval)
        
        console.log(`[Dashboard] 📡 Started adaptive polling (checks every ${baseInterval}ms, adapts to ${getPollingInterval()}ms)`)
      }
      
      const stopPolling = () => {
        isPollingActive = false
        if (pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
        }
        console.log(`[Dashboard] ⏸️ Stopped polling`)
      }
      
      // Page Visibility API - pause polling when tab is hidden
      // Debounce to prevent rapid start/stop cycles (500ms)
      const handleVisibilityChange = () => {
        // Clear existing debounce timeout
        if (debounceTimeout) {
          clearTimeout(debounceTimeout)
        }
        
        debounceTimeout = setTimeout(() => {
          isPageVisible = !document.hidden
          if (isPageVisible && isNetworkOnline) {
            console.log(`[Dashboard] 👁️ Page visible - resuming polling`)
            if (!pollingInterval) {
              startPolling()
            }
          } else {
            console.log(`[Dashboard] 👁️ Page hidden - pausing polling`)
            stopPolling()
          }
          debounceTimeout = null
        }, 500)
      }
      
      // Network state monitoring
      // Debounce to prevent rapid start/stop cycles (500ms)
      const handleOnline = () => {
        // Clear existing debounce timeout
        if (debounceTimeout) {
          clearTimeout(debounceTimeout)
        }
        
        debounceTimeout = setTimeout(() => {
          isNetworkOnline = true
          console.log(`[Dashboard] ✅ Network online - resuming polling`)
          if (!pollingInterval && isPageVisible) {
            startPolling()
          }
          debounceTimeout = null
        }, 500)
      }
      
      const handleOffline = () => {
        // Clear existing debounce timeout
        if (debounceTimeout) {
          clearTimeout(debounceTimeout)
        }
        
        // Stop immediately on offline (no debounce needed)
        isNetworkOnline = false
        console.log(`[Dashboard] ⚠️ Network offline - pausing polling`)
        stopPolling()
      }
      
      // Set up event listeners
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      
      // Start polling initially (if page is visible and online)
      if (isPageVisible && isNetworkOnline) {
        startPolling()
      }
      
      return () => {
        isMounted = false
        console.log(`[Dashboard] Cleaning up subscription for user: ${userId}`)
        unsubscribe()
        hideEmergencyAlert()
        stopPolling()
        
        // Clear debounce timeout
        if (debounceTimeout) {
          clearTimeout(debounceTimeout)
          debounceTimeout = null
        }
        
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
      }
    // Only depend on user.id to prevent re-running when user object reference changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Auto-register push notifications when user logs in
  useEffect(() => {
    if (!user) return

    // Check if push notifications are already enabled
    const checkPushStatus = async () => {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready
          const subscription = await registration.pushManager.getSubscription()
          setPushEnabled(!!subscription)
          
          // If not enabled, try to register automatically
          if (!subscription) {
            try {
              const enabled = await registerDeviceForPush()
              setPushEnabled(enabled)
            } catch (err) {
              console.warn('[Push] Auto-registration failed (user may need to grant permission):', err)
              setPushEnabled(false)
            }
          }
        } else {
          setPushEnabled(false)
        }
      } catch (err) {
        console.warn('[Push] Could not check push status:', err)
        setPushEnabled(false)
      }
    }

    checkPushStatus()
  }, [user?.id])

  const handleEmergencyButton = async () => {
    if (!user) return

    // Use ref to prevent state updates after unmount
    if (!isMountedRef.current) return

    setEmergencyLoading(true)

      try {
        // Get current location on client-side (optional - continue without if fails)
        let location
        try {
          const coords = await getCurrentLocation()
          // Check if coords is null before using it
          if (coords) {
            const address = await reverseGeocode(coords.lat, coords.lng).catch(() => null)
            location = {
              lat: coords.lat,
              lng: coords.lng,
              address: address || undefined,
            }
          }
          // If coords is null, location remains undefined and we continue without it
        } catch (error) {
          console.warn('Failed to get location, continuing without location:', error)
          // Continue without location - alert can still be created
        }

      // Create emergency alert using client-side service with default type 'other'
      let emergencyAlert
      try {
        const { createEmergencyAlert } = await import('@/lib/services/emergency')
        
        emergencyAlert = await createEmergencyAlert(
          'other',
          location || undefined
        )
      } catch (alertError: any) {
        // Handle rate limit errors specifically
        if (alertError.message?.includes('Rate limit')) {
          if (isMountedRef.current) {
            setEmergencyLoading(false)
            window.alert(alertError.message)
          }
          return
        }
        
        // Re-throw other errors
        throw new Error(`Failed to create emergency alert: ${alertError.message || 'Unknown error'}`)
      }

      // Note: Contact notification is handled server-side in the API route
      // No need to call notifyEmergencyContacts() here - it's already done

      // Navigate to emergency screen immediately using window.location to avoid React state updates
      if (emergencyAlert && emergencyAlert.id) {
        // Set flag to prevent any further state updates
        isMountedRef.current = false
        
        // Use window.location.href for full page reload - prevents React error #321
        // Use setTimeout to ensure navigation happens after current execution completes
        setTimeout(() => {
          window.location.href = `/emergency/active/${emergencyAlert.id}`
        }, 0)
        
        // Don't update state after navigation - component will unmount
        return
      }
    } catch (error: any) {
      // Only update state if component is still mounted
      if (!isMountedRef.current) return
      
      // Properly serialize error for logging
      const serializedError = serializeError(error)
      console.error('Emergency button error:', {
        ...serializedError,
        userEmail: user?.email,
        userId: user?.id,
        rawError: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
      })
      
      // Extract error message - handle different error types
      let errorMessage = 'Failed to create emergency alert. Please try again.'
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error?.message) {
        errorMessage = error.message
      }
      
      // Show error to user
      window.alert(errorMessage)
    } finally {
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setEmergencyLoading(false)
      }
    }
  }

  const handleCancelAlert = async () => {
    if (!activeEmergency || !user) return

    const confirmed = window.confirm(
      'Are you sure you want to cancel this emergency alert?'
    )

    if (!confirmed) return

    try {
      const { cancelEmergencyAlert } = await import('@/lib/services/emergency')
      await cancelEmergencyAlert(activeEmergency.id)
      
      // Refresh active emergency state
      await loadActiveEmergency()
      
      // Show success message
      console.log('[Dashboard] ✅ Alert cancelled successfully')
    } catch (error: any) {
      console.error('[Dashboard] ❌ Failed to cancel alert:', error)
      window.alert(
        error?.message || 'Failed to cancel alert. Please try again.'
      )
    }
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/auth/login')
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">PSP</h1>
          <p className="text-white/90">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">PSP</h1>
            <p className="text-white/90">Welcome, {profile?.full_name || user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Push Notification Status */}
            {pushEnabled !== null && (
              <div className="flex items-center gap-2 text-white/80 text-sm" title={pushEnabled ? "Push notifications enabled" : "Push notifications not enabled"}>
                {pushEnabled ? (
                  <Bell className="w-4 h-4 text-green-400" />
                ) : (
                  <BellOff className="w-4 h-4 text-yellow-400" />
                )}
              </div>
            )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSignOut}
            className="flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
          </div>
        </div>

        {/* Emergency Button */}
        <Card className="mb-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Emergency Alert</h2>
            <p className="text-gray-600 mb-6">
              Press this button if you need help
            </p>
            <Button
              variant="emergency"
              size="lg"
              onClick={handleEmergencyButton}
              disabled={emergencyLoading}
              className="w-full py-8 text-2xl font-bold emergency-pulse"
            >
              {emergencyLoading ? (
                'Creating Alert...'
              ) : (
                <>
                  <AlertTriangle className="w-8 h-8 mr-2 inline" />
                  EMERGENCY
                </>
              )}
            </Button>
            <p className="text-xs text-gray-500 mt-4">
              Your location will be shared with your emergency contacts
            </p>
          </div>
        </Card>


        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card 
            className="cursor-pointer hover:shadow-lg transition-shadow" 
            onClick={() => router.push('/contacts')}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-sa-green rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Emergency Contacts</p>
                <p className="text-2xl font-bold text-gray-900">{contactCount}</p>
              </div>
            </div>
          </Card>

          <Card 
            className={activeEmergency ? "cursor-pointer hover:shadow-lg transition-shadow border-2 border-red-500" : ""}
            onClick={activeEmergency ? handleCancelAlert : undefined}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 ${activeEmergency ? 'bg-red-500' : 'bg-sa-blue'} rounded-lg flex items-center justify-center`}>
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Active Alerts</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {activeEmergency ? '1' : '0'}
                  </p>
                </div>
              </div>
              {activeEmergency && (
                <div className="text-right">
                  <p className="text-xs text-red-600 font-medium">Click to cancel</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => router.push('/profile')}>
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-sa-blue" />
              <span className="font-medium">Profile Settings</span>
            </div>
          </Card>
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => router.push('/diagnostics')}>
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <span className="font-medium">Connection Diagnostics</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

