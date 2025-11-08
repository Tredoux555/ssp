/**
 * Real-Time Subscription Manager for PSP
 * Centralized management for Supabase Realtime subscriptions
 */

import { createClient } from '../supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface SubscriptionConfig {
  channel: string
  table: string
  filter?: string
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  callback: (payload: any) => void
}

interface ActiveSubscription {
  channel: RealtimeChannel
  config: SubscriptionConfig
}

class SubscriptionManager {
  private subscriptions: Map<string, ActiveSubscription> = new Map()
  private supabase = createClient()
  private reconnectAttempts: Map<string, number> = new Map()
  private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private reconnecting: Map<string, boolean> = new Map()
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map()
  private lastReconnectAttempt: Map<string, number> = new Map() // Timestamp of last reconnection attempt
  private circuitOpen: Map<string, number> = new Map() // Timestamp when circuit opened (max attempts reached)
  private reconnectHistory: Map<string, number[]> = new Map() // Track reconnection timestamps for rate limiting
  private cooldownPeriods: Map<string, number> = new Map() // Per-subscription cooldown periods
  private maxReconnectAttempts = 5
  private reconnectDelays = [1000, 2000, 5000, 10000, 30000] // Exponential backoff
  private defaultCooldownPeriod = 5000 // 5 seconds cooldown after failed reconnection
  private circuitOpenDuration = 300000 // 5 minutes before allowing reconnection after max attempts

  subscribe(config: SubscriptionConfig): () => void {
    const key = `${config.channel}-${config.table}-${config.filter || ''}`

    // Check if subscription already exists
    if (this.subscriptions.has(key)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Realtime] Subscription already exists for ${key}`)
      }
      // Return existing unsubscribe function to prevent duplicates
      return () => this.unsubscribe(key)
    }

    // Check if supabase client is available
    if (!this.supabase) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[Realtime] Supabase client not available for subscription')
      }
      return () => {} // Return no-op unsubscribe function
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Realtime] Setting up subscription:`, {
        channel: config.channel,
        table: config.table,
        event: config.event || 'UPDATE',
        filter: config.filter || 'none',
        key
      })
    }

    try {
      const channel = this.supabase
        .channel(config.channel)
        .on(
          'postgres_changes' as any,
          {
            event: config.event || 'UPDATE',
            schema: 'public',
            table: config.table,
            ...(config.filter && { filter: config.filter }),
          },
          (payload: any) => {
            try {
              // Only log events in development to reduce noise
              if (process.env.NODE_ENV === 'development') {
                console.log(`[Realtime] Event received: ${payload.eventType || 'unknown'} on ${config.table}`, {
                  channel: config.channel,
                  event: config.event,
                  table: config.table,
                  filter: config.filter,
                  hasNew: !!payload.new,
                  hasOld: !!payload.old,
                })
              }
              config.callback(payload)
            } catch (callbackError) {
              console.error(`[Realtime] ❌ Error in callback for ${config.channel}:`, callbackError)
              // Don't rethrow - prevent breaking the subscription
            }
          }
        )
        .subscribe((status: any, err?: any) => {
          if (status === 'SUBSCRIBED') {
            // Reset reconnect attempts, clear circuit, cooldown, and clear reconnecting flag on success
            this.reconnectAttempts.delete(key)
            this.circuitOpen.delete(key)
            this.reconnecting.delete(key)
            this.lastReconnectAttempt.delete(key)
            this.reconnectHistory.delete(key)
            this.cooldownPeriods.delete(key)
            
            console.log(`[Realtime] ✅ Successfully subscribed to ${config.channel}`, {
              table: config.table,
              event: config.event || 'UPDATE',
              filter: config.filter || 'none',
              channel: config.channel
            })
            console.log(`[Realtime] 🔗 Connection established - ready to receive events`)
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Only attempt reconnection if subscription still exists, not already reconnecting, not in cooldown, and circuit not open
            if (this.subscriptions.has(key) && !this.reconnecting.get(key) && !this.isInCooldown(key) && !this.isCircuitOpen(key)) {
              const statusMsg = status === 'CHANNEL_ERROR' ? 'Channel error' : 
                               status === 'TIMED_OUT' ? 'Subscription timed out' : 
                               'Subscription closed'
              
              console.warn(`[Realtime] ⚠️ ${statusMsg} for ${config.channel}`, {
                table: config.table,
                event: config.event || 'UPDATE',
                filter: config.filter || 'none',
                error: err?.message || err,
                errorDetails: err
              })
              console.warn(`[Realtime] ⚠️ Attempting reconnection...`)
              
              // Clear existing reconnection timeout if any
              const existingTimeout = this.reconnectTimeouts.get(key)
              if (existingTimeout) {
                clearTimeout(existingTimeout)
                this.reconnectTimeouts.delete(key)
              }
              
              // Debounce reconnection attempt (1 second)
              const reconnectTimeout = setTimeout(() => {
                // Double-check subscription still exists, not reconnecting, not in cooldown, circuit not open
                if (this.subscriptions.has(key) && !this.reconnecting.get(key) && !this.isInCooldown(key) && !this.isCircuitOpen(key)) {
                  this.reconnectSubscription(key, config)
                }
                this.reconnectTimeouts.delete(key)
              }, 1000)
              
              this.reconnectTimeouts.set(key, reconnectTimeout)
            }
          } else {
            // Log all subscription statuses for debugging
            console.log(`[Realtime] Subscription status for ${config.channel}:`, {
              status,
              table: config.table,
              event: config.event || 'UPDATE',
              filter: config.filter || 'none',
              error: err?.message || err,
              errorDetails: err
            })
          }
        })

      this.subscriptions.set(key, { channel, config })

      // Only start health monitoring in production (disabled in development to prevent hanging)
      // In development, rely on Supabase's built-in reconnection and the CLOSED event handler
      if (process.env.NODE_ENV === 'production') {
        setTimeout(() => {
          const subscription = this.subscriptions.get(key)
          if (subscription) {
            // Start periodic health monitoring (only in production, every 60s)
            const healthCheckInterval = setInterval(() => {
              const currentSubscription = this.subscriptions.get(key)
              if (currentSubscription) {
                // Skip health check if reconnecting, in cooldown, or circuit open
                if (this.reconnecting.get(key) || this.isInCooldown(key) || this.isCircuitOpen(key)) {
                  return
                }
                
                const currentState = (currentSubscription.channel as any).state
                // Only trigger reconnection for truly disconnected states, not during normal connection states
                if (currentState === 'closed' || currentState === 'errored' || currentState === 'timedout') {
                  // Only attempt reconnection if not already reconnecting, not in cooldown, circuit not open
                  if (!this.reconnecting.get(key) && !this.isInCooldown(key) && !this.isCircuitOpen(key)) {
                    console.warn(`[Realtime] ⚠️ Channel ${config.channel} is not connected (state: ${currentState}), attempting reconnection...`)
                    this.reconnectSubscription(key, config)
                  }
                }
              } else {
                // Subscription no longer exists, clean up
                clearInterval(healthCheckInterval)
                this.healthCheckIntervals.delete(key)
              }
            }, 60000) // Check every 60 seconds
            
            this.healthCheckIntervals.set(key, healthCheckInterval)
          }
        }, 2000)
      }

      return () => this.unsubscribe(key)
    } catch (error) {
      console.error('[Realtime] Failed to create subscription:', error)
      return () => {} // Return no-op unsubscribe function
    }
  }

  unsubscribe(key: string): void {
    const subscription = this.subscriptions.get(key)
    if (subscription && this.supabase) {
      try {
        this.supabase.removeChannel(subscription.channel)
      } catch (error) {
        console.error('Error removing channel:', error)
      }
      this.subscriptions.delete(key)
    }
    
    // Clean up health check interval
    const healthCheckInterval = this.healthCheckIntervals.get(key)
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval)
      this.healthCheckIntervals.delete(key)
    }
    
    // Clear reconnection timeout if any
    const reconnectTimeout = this.reconnectTimeouts.get(key)
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      this.reconnectTimeouts.delete(key)
    }
    
    // Clear reconnect attempts, reconnecting flag, cooldown, circuit, and history
    this.reconnectAttempts.delete(key)
    this.reconnecting.delete(key)
    this.lastReconnectAttempt.delete(key)
    this.circuitOpen.delete(key)
    this.reconnectHistory.delete(key)
    this.cooldownPeriods.delete(key)
  }

  unsubscribeAll(): void {
    if (!this.supabase) {
      this.subscriptions.clear()
      return
    }
    this.subscriptions.forEach((subscription) => {
      try {
        this.supabase.removeChannel(subscription.channel)
      } catch (error) {
        console.error('Error removing channel:', error)
      }
    })
    
    // Clear all health check intervals
    this.healthCheckIntervals.forEach((interval) => clearInterval(interval))
    this.healthCheckIntervals.clear()
    
    // Clear all reconnection timeouts
    this.reconnectTimeouts.forEach((timeout) => clearTimeout(timeout))
    this.reconnectTimeouts.clear()
    
    // Clear all reconnect attempts, reconnecting flags, cooldowns, circuits, and history
    this.reconnectAttempts.clear()
    this.reconnecting.clear()
    this.lastReconnectAttempt.clear()
    this.circuitOpen.clear()
    this.reconnectHistory.clear()
    this.cooldownPeriods.clear()
    
    this.subscriptions.clear()
  }

  private isInCooldown(key: string): boolean {
    const lastAttempt = this.lastReconnectAttempt.get(key)
    if (!lastAttempt) return false
    
    const cooldownPeriod = this.cooldownPeriods.get(key) || this.defaultCooldownPeriod
    const now = Date.now()
    const timeSinceLastAttempt = now - lastAttempt
    return timeSinceLastAttempt < cooldownPeriod
  }
  
  private isCircuitOpen(key: string): boolean {
    const circuitOpenTime = this.circuitOpen.get(key)
    if (!circuitOpenTime) return false
    
    const now = Date.now()
    const timeSinceCircuitOpened = now - circuitOpenTime
    
    // If circuit has been open for more than circuitOpenDuration, allow reconnection
    if (timeSinceCircuitOpened > this.circuitOpenDuration) {
      this.circuitOpen.delete(key)
      this.reconnectAttempts.delete(key) // Reset attempts after circuit cooldown
      return false
    }
    
    return true
  }
  
  private checkRateLimit(key: string): boolean {
    const now = Date.now()
    const history = this.reconnectHistory.get(key) || []
    
    // Remove attempts older than 5 minutes
    const recentHistory = history.filter(timestamp => now - timestamp < 300000)
    
    // Check if more than 10 attempts in last 5 minutes
    if (recentHistory.length >= 10) {
      return true // Rate limit exceeded
    }
    
    // Check if more than 3 attempts in last minute
    const lastMinute = recentHistory.filter(timestamp => now - timestamp < 60000)
    if (lastMinute.length >= 3) {
      return true // Rate limit exceeded
    }
    
    // Add current attempt timestamp
    recentHistory.push(now)
    this.reconnectHistory.set(key, recentHistory)
    
    return false // Within rate limit
  }
  
  private reconnectSubscription(key: string, config: SubscriptionConfig): void {
    // In development, add extra guard against rapid reconnection attempts
    // This prevents Fast Refresh from causing reconnection loops
    if (process.env.NODE_ENV === 'development') {
      // Check if we're in a rapid reconnection loop (more than 3 attempts in 2 seconds)
      const recentAttempts = this.reconnectHistory.get(key) || []
      const now = Date.now()
      const lastTwoSeconds = recentAttempts.filter(timestamp => now - timestamp < 2000)
      if (lastTwoSeconds.length >= 3) {
        // Too many attempts too quickly - likely Fast Refresh issue
        // Skip this reconnection attempt
        return
      }
    }
    
    // Prevent concurrent reconnection attempts
    if (this.reconnecting.get(key)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Realtime] ⏭️ Already reconnecting ${key}, skipping duplicate attempt`)
      }
      return
    }
    
    // Check if subscription still exists
    if (!this.subscriptions.has(key)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Realtime] ⏭️ Subscription ${key} no longer exists, skipping reconnection`)
      }
      return
    }
    
    // Check if in cooldown
    if (this.isInCooldown(key)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Realtime] ⏭️ Subscription ${key} is in cooldown, skipping reconnection`)
      }
      return
    }
    
    // Check if circuit is open
    if (this.isCircuitOpen(key)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Realtime] ⏭️ Circuit open for ${key}, skipping reconnection`)
      }
      return
    }
    
    // Check rate limit
    if (this.checkRateLimit(key)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[Realtime] ⚠️ Rate limit exceeded for ${key}, increasing cooldown`)
      }
      // Increase cooldown to 30 seconds if rate limit exceeded
      this.lastReconnectAttempt.set(key, Date.now())
      this.cooldownPeriods.set(key, 30000)
      return
    }
    
    // Reset cooldown period to default for this subscription
    this.cooldownPeriods.set(key, this.defaultCooldownPeriod)
    
    const attempts = this.reconnectAttempts.get(key) || 0
    
    if (attempts >= this.maxReconnectAttempts) {
      // Open circuit breaker - stop reconnecting for 5 minutes
      this.circuitOpen.set(key, Date.now())
      if (process.env.NODE_ENV === 'development') {
        console.error(`[Realtime] ❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${key} - circuit opened for ${this.circuitOpenDuration / 1000}s`)
      }
      this.reconnecting.delete(key)
      return
    }
    
    // Mark as reconnecting and record attempt time
    this.reconnecting.set(key, true)
    this.lastReconnectAttempt.set(key, Date.now())
    
    const delay = this.reconnectDelays[attempts] || 30000
    this.reconnectAttempts.set(key, attempts + 1)
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Realtime] 🔄 Attempting to reconnect ${key} (attempt ${attempts + 1}/${this.maxReconnectAttempts}) in ${delay}ms`)
    }
    
    // Clear any existing reconnection timeout
    const existingTimeout = this.reconnectTimeouts.get(key)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      this.reconnectTimeouts.delete(key)
    }
    
    const reconnectTimeout = setTimeout(() => {
      // Clear reconnecting flag
      this.reconnecting.delete(key)
      this.reconnectTimeouts.delete(key)
      
      // Only reconnect if subscription still exists
      if (this.subscriptions.has(key)) {
        // Unsubscribe old channel
        const oldSubscription = this.subscriptions.get(key)
        if (oldSubscription && this.supabase) {
          try {
            this.supabase.removeChannel(oldSubscription.channel)
          } catch (error) {
            // Ignore errors during cleanup
          }
        }
        this.subscriptions.delete(key)
        
        // Clear health check interval
        const healthCheckInterval = this.healthCheckIntervals.get(key)
        if (healthCheckInterval) {
          clearInterval(healthCheckInterval)
          this.healthCheckIntervals.delete(key)
        }
        
        // Resubscribe
        this.subscribe(config)
      } else {
        // Subscription was removed, clear reconnecting flag
        this.reconnecting.delete(key)
      }
    }, delay)
    
    this.reconnectTimeouts.set(key, reconnectTimeout)
  }

  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys())
  }

  hasSubscription(key: string): boolean {
    return this.subscriptions.has(key)
  }
}

let subscriptionManager: SubscriptionManager | null = null

// Cleanup function for Fast Refresh in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // Clean up subscriptions on module reload (Fast Refresh)
  if ((window as any).__subscriptionManagerCleanup) {
    try {
      (window as any).__subscriptionManagerCleanup()
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  
  // Store cleanup function for next Fast Refresh
  (window as any).__subscriptionManagerCleanup = () => {
    if (subscriptionManager) {
      subscriptionManager.unsubscribeAll()
      subscriptionManager = null
    }
  }
}

export function getSubscriptionManager(): SubscriptionManager {
  if (!subscriptionManager) {
    subscriptionManager = new SubscriptionManager()
  }
  return subscriptionManager
}

/**
 * Subscribe to emergency alert updates for a user
 */
export function subscribeToEmergencyAlerts(
  userId: string,
  callback: (alert: any) => void
): () => void {
  const manager = getSubscriptionManager()
  return manager.subscribe({
    channel: `emergency-alerts-${userId}`,
    table: 'emergency_alerts',
    filter: `user_id=eq.${userId}`,
    event: '*',
    callback: (payload) => {
      callback(payload.new || payload.old)
    },
  })
}

/**
 * Subscribe to location history updates during an emergency
 */
export function subscribeToLocationHistory(
  alertId: string,
  callback: (location: any) => void
): () => void {
  const manager = getSubscriptionManager()
  return manager.subscribe({
    channel: `location-history-${alertId}`,
    table: 'location_history',
    filter: `alert_id=eq.${alertId}`,
    event: 'INSERT',
    callback: (payload) => {
      callback(payload.new)
    },
  })
}

/**
 * Subscribe to alert responses for an emergency
 * Note: This subscription may fail if RLS blocks access - that's OK
 */
export function subscribeToAlertResponses(
  alertId: string,
  callback: (response: any) => void
): () => void {
  const manager = getSubscriptionManager()
  try {
    return manager.subscribe({
      channel: `alert-responses-${alertId}`,
      table: 'alert_responses',
      filter: `alert_id=eq.${alertId}`,
      event: '*',
      callback: (payload) => {
        // Only process if payload has data
        if (payload.new || payload.old) {
          callback(payload.new || payload.old)
        }
      },
    })
  } catch (error) {
    // If subscription fails (e.g., RLS blocks), return no-op unsubscribe
    console.warn('[Realtime] Failed to subscribe to alert_responses (non-critical):', error)
    return () => {}
  }
}

/**
 * Subscribe to emergency alerts for a contact user
 * This fires when the user is notified about an emergency alert
 * Used to receive push notifications when someone in your contact list triggers an alert
 */
export function subscribeToContactAlerts(
  contactUserId: string,
  callback: (alert: any) => void
): () => void {
  console.log(`[Realtime] 🔔 Setting up contact alert subscription for user: ${contactUserId}`)
  
  const manager = getSubscriptionManager()
  
  const unsubscribe = manager.subscribe({
    channel: `contact-alerts-${contactUserId}`,
    table: 'emergency_alerts',
    event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
    callback: (payload) => {
      try {
        console.log(`[Realtime] 📨 RAW EVENT RECEIVED for user ${contactUserId}:`, {
          eventType: payload.eventType,
          hasNew: !!payload.new,
          hasOld: !!payload.old,
          newAlertId: payload.new?.id,
          oldAlertId: payload.old?.id,
          newStatus: payload.new?.status,
          oldStatus: payload.old?.status,
          newContactsNotified: payload.new?.contacts_notified,
          oldContactsNotified: payload.old?.contacts_notified,
          payloadKeys: Object.keys(payload)
        })
        
        const alert = payload.new || payload.old
        
        console.log(`[Realtime] 📨 Processed alert for user ${contactUserId}:`, {
          event: payload.eventType,
          alertId: alert?.id,
          status: alert?.status,
          contactsNotified: alert?.contacts_notified,
          contactsNotifiedType: typeof alert?.contacts_notified,
          contactsNotifiedIsArray: Array.isArray(alert?.contacts_notified),
          contactsNotifiedLength: Array.isArray(alert?.contacts_notified) ? alert.contacts_notified.length : 'N/A'
        })
        
        // Only fire callback if this contact user is in the contacts_notified array
        if (alert && alert.contacts_notified && Array.isArray(alert.contacts_notified)) {
          try {
            // Normalize IDs for comparison (trim whitespace, ensure string comparison)
            const normalizedContactUserId = contactUserId.trim()
            const normalizedContactsNotified = alert.contacts_notified.map((id: string) => String(id).trim())
            
            const isNotified = normalizedContactsNotified.some((id: string) => id === normalizedContactUserId)
            
            console.log(`[Realtime] 🔍 Checking if user ${contactUserId} is notified:`, {
              isNotified,
              normalizedContactUserId,
              normalizedContactsNotified,
              alertStatus: alert.status
            })
            
            // Check if this is a new alert being created or updated to active status
            if (isNotified && alert.status === 'active') {
              console.log(`[Realtime] ✅ TRIGGERING CALLBACK for contact ${contactUserId} - Alert ${alert.id}`)
              callback(alert)
            } else {
              console.log(`[Realtime] ⏭️ Skipping callback:`, {
                isNotified,
                status: alert.status,
                reason: !isNotified ? 'User not in contacts_notified' : `Status is ${alert.status}, not 'active'`
              })
            }
          } catch (processingError) {
            console.error(`[Realtime] ❌ Error processing alert for user ${contactUserId}:`, processingError)
            // Don't rethrow - prevent breaking the subscription
          }
        } else {
          console.log(`[Realtime] ⏭️ Skipping - alert missing contacts_notified or not an array:`, {
            hasAlert: !!alert,
            hasContactsNotified: !!alert?.contacts_notified,
            isArray: Array.isArray(alert?.contacts_notified)
          })
        }
      } catch (callbackError) {
        console.error(`[Realtime] ❌ Error in contact alert callback for user ${contactUserId}:`, callbackError)
        // Don't rethrow - prevent breaking the subscription
      }
    },
  })
  
  console.log(`[Realtime] ✅ Contact alert subscription setup complete for user: ${contactUserId}`)
  return unsubscribe
}

/**
 * Cleanup all subscriptions
 */
export function cleanupAllSubscriptions(): void {
  const manager = getSubscriptionManager()
  manager.unsubscribeAll()
}

