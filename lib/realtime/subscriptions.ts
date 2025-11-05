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
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map()
  private maxReconnectAttempts = 5
  private reconnectDelays = [1000, 2000, 5000, 10000, 30000] // Exponential backoff

  subscribe(config: SubscriptionConfig): () => void {
    const key = `${config.channel}-${config.table}-${config.filter || ''}`

    // Check if subscription already exists
    if (this.subscriptions.has(key)) {
      console.log(`[Realtime] Subscription already exists for ${key}`)
      return () => this.unsubscribe(key)
    }

    // Check if supabase client is available
    if (!this.supabase) {
      console.warn('[Realtime] Supabase client not available for subscription')
      return () => {} // Return no-op unsubscribe function
    }

    console.log(`[Realtime] Setting up subscription:`, {
      channel: config.channel,
      table: config.table,
      event: config.event || 'UPDATE',
      filter: config.filter || 'none',
      key
    })

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
              console.log(`[Realtime] Event received: ${payload.eventType || 'unknown'} on ${config.table}`, {
                channel: config.channel,
                event: config.event,
                table: config.table,
                filter: config.filter,
                hasNew: !!payload.new,
                hasOld: !!payload.old,
              })
              config.callback(payload)
            } catch (callbackError) {
              console.error(`[Realtime] ❌ Error in callback for ${config.channel}:`, callbackError)
              // Don't rethrow - prevent breaking the subscription
            }
          }
        )
        .subscribe((status: any, err?: any) => {
          if (status === 'SUBSCRIBED') {
            // Reset reconnect attempts on success
            this.reconnectAttempts.delete(key)
            console.log(`[Realtime] ✅ Successfully subscribed to ${config.channel} (${config.table}, event: ${config.event || 'UPDATE'})`)
            console.log(`[Realtime] 🔗 Connection established - ready to receive events`)
          } else if (status === 'CHANNEL_ERROR') {
            console.error(`[Realtime] ❌ Channel error for ${config.channel}:`, err)
            console.error(`[Realtime] 🔗 Connection failed - check Supabase Realtime configuration`)
            console.warn(`[Realtime] ⚠️ Realtime subscription failed - attempting reconnection...`)
            // Attempt reconnection
            setTimeout(() => this.reconnectSubscription(key, config), 1000)
          } else if (status === 'TIMED_OUT') {
            console.error(`[Realtime] ⏱️ Subscription timed out for ${config.channel}`)
            console.error(`[Realtime] 🔗 Connection timeout - check network and Supabase Realtime`)
            console.warn(`[Realtime] ⚠️ Realtime subscription timed out - attempting reconnection...`)
            // Attempt reconnection
            setTimeout(() => this.reconnectSubscription(key, config), 1000)
          } else if (status === 'CLOSED') {
            console.warn(`[Realtime] ⚠️ Subscription closed for ${config.channel}`)
            console.warn(`[Realtime] 🔗 Connection closed - attempting reconnection...`)
            // Attempt reconnection
            setTimeout(() => this.reconnectSubscription(key, config), 1000)
          } else {
            console.log(`[Realtime] Subscription status for ${config.channel}: ${status}`, err ? `Error: ${err}` : '')
            console.log(`[Realtime] 🔗 Connection status: ${status}`)
          }
        })

      this.subscriptions.set(key, { channel, config })

      // Log subscription health check
      setTimeout(() => {
        const subscription = this.subscriptions.get(key)
        if (subscription) {
          const channelState = (subscription.channel as any).state
          console.log(`[Realtime] Subscription health check for ${config.channel}:`, {
            state: channelState,
            key,
            table: config.table
          })
          
          // Start periodic health monitoring
          const healthCheckInterval = setInterval(() => {
            const currentSubscription = this.subscriptions.get(key)
            if (currentSubscription) {
              const currentState = (currentSubscription.channel as any).state
              if (currentState !== 'joined' && currentState !== 'joining') {
                console.warn(`[Realtime] ⚠️ Channel ${config.channel} is not connected (state: ${currentState}), attempting reconnection...`)
                clearInterval(healthCheckInterval)
                this.healthCheckIntervals.delete(key)
                this.reconnectSubscription(key, config)
              }
            } else {
              clearInterval(healthCheckInterval)
              this.healthCheckIntervals.delete(key)
            }
          }, 30000) // Check every 30 seconds
          
          this.healthCheckIntervals.set(key, healthCheckInterval)
        }
      }, 2000)

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
    
    // Clear reconnect attempts
    this.reconnectAttempts.delete(key)
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
    
    // Clear all reconnect attempts
    this.reconnectAttempts.clear()
    
    this.subscriptions.clear()
  }

  private reconnectSubscription(key: string, config: SubscriptionConfig): void {
    const attempts = this.reconnectAttempts.get(key) || 0
    
    if (attempts >= this.maxReconnectAttempts) {
      console.error(`[Realtime] ❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${key} - polling will handle alerts`)
      return
    }
    
    const delay = this.reconnectDelays[attempts] || 30000
    this.reconnectAttempts.set(key, attempts + 1)
    
    console.log(`[Realtime] 🔄 Attempting to reconnect ${key} (attempt ${attempts + 1}/${this.maxReconnectAttempts}) in ${delay}ms`)
    
    setTimeout(() => {
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
      }
    }, delay)
  }

  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys())
  }

  hasSubscription(key: string): boolean {
    return this.subscriptions.has(key)
  }
}

let subscriptionManager: SubscriptionManager | null = null

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
  console.log(`[Realtime] 📡 Channel: contact-alerts-${contactUserId}`)
  console.log(`[Realtime] 📋 Table: emergency_alerts`)
  console.log(`[Realtime] 📨 Event: * (all events)`)
  
  const manager = getSubscriptionManager()
  const unsubscribe = manager.subscribe({
    channel: `contact-alerts-${contactUserId}`,
    table: 'emergency_alerts',
    event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
    callback: (payload) => {
      try {
        const alert = payload.new || payload.old
        console.log(`[Realtime] 📨 Contact alert event received for user ${contactUserId}:`, {
          eventType: payload.eventType,
          alertId: alert?.id,
          status: alert?.status,
          contactsNotified: alert?.contacts_notified,
          contactsNotifiedType: Array.isArray(alert?.contacts_notified) ? 'array' : typeof alert?.contacts_notified,
          contactsNotifiedLength: Array.isArray(alert?.contacts_notified) ? alert.contacts_notified.length : 'N/A',
          alertUserId: alert?.user_id,
          hasNew: !!payload.new,
          hasOld: !!payload.old,
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
              contactUserId: normalizedContactUserId,
              contactsNotified: normalizedContactsNotified,
              contactsNotifiedRaw: alert.contacts_notified,
              alertStatus: alert.status,
              alertUserId: alert.user_id,
              matchFound: normalizedContactsNotified.includes(normalizedContactUserId),
            })
            
            // Check if this is a new alert being created or updated to active status
            if (isNotified && alert.status === 'active') {
              console.log(`[Realtime] ✅ TRIGGERING CALLBACK for contact ${contactUserId} - Alert ${alert.id}`)
              console.log(`[Realtime] 🚨 ALERT SHOULD NOW APPEAR ON DEVICE`)
              callback(alert)
            } else {
              console.log(`[Realtime] ⏭️ Skipping callback:`, {
                isNotified,
                status: alert.status,
                reason: !isNotified ? 'user not in contacts_notified' : `status is ${alert.status} (not 'active')`
              })
            }
          } catch (processingError) {
            console.error(`[Realtime] ❌ Error processing alert for user ${contactUserId}:`, processingError)
            // Don't rethrow - prevent breaking the subscription
          }
        } else {
          console.log(`[Realtime] ⚠️ No contacts_notified array or invalid alert structure:`, {
            hasAlert: !!alert,
            hasContactsNotified: !!alert?.contacts_notified,
            isArray: Array.isArray(alert?.contacts_notified),
            contactsNotifiedType: typeof alert?.contacts_notified,
            contactsNotifiedValue: alert?.contacts_notified
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

