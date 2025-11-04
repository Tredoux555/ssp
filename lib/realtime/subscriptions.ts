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
            console.log(`[Realtime] Event received: ${payload.eventType || 'unknown'} on ${config.table}`, {
              channel: config.channel,
              event: config.event,
              table: config.table,
              filter: config.filter,
              hasNew: !!payload.new,
              hasOld: !!payload.old,
            })
            config.callback(payload)
          }
        )
        .subscribe((status: any) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[Realtime] ✅ Successfully subscribed to ${config.channel} (${config.table}, event: ${config.event || 'UPDATE'})`)
          } else if (status === 'CHANNEL_ERROR') {
            console.error(`[Realtime] ❌ Channel error for ${config.channel}`)
          } else if (status === 'TIMED_OUT') {
            console.error(`[Realtime] ⏱️ Subscription timed out for ${config.channel}`)
          } else if (status === 'CLOSED') {
            console.warn(`[Realtime] ⚠️ Subscription closed for ${config.channel}`)
          } else {
            console.log(`[Realtime] Subscription status for ${config.channel}: ${status}`)
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
    this.subscriptions.clear()
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
 */
export function subscribeToAlertResponses(
  alertId: string,
  callback: (response: any) => void
): () => void {
  const manager = getSubscriptionManager()
  return manager.subscribe({
    channel: `alert-responses-${alertId}`,
    table: 'alert_responses',
    filter: `alert_id=eq.${alertId}`,
    event: '*',
    callback: (payload) => {
      callback(payload.new || payload.old)
    },
  })
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
      } else {
        console.log(`[Realtime] ⚠️ No contacts_notified array or invalid alert structure:`, {
          hasAlert: !!alert,
          hasContactsNotified: !!alert?.contacts_notified,
          isArray: Array.isArray(alert?.contacts_notified),
          contactsNotifiedType: typeof alert?.contacts_notified,
          contactsNotifiedValue: alert?.contacts_notified
        })
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

