import { createClient } from './supabase'
import { EmergencyAlert } from '@/types/database'

/**
 * Create an emergency alert
 */
export async function createEmergencyAlert(
  userId: string,
  alertType: 'robbery' | 'house_breaking' | 'car_jacking' | 'accident' | 'other' = 'other',
  location?: { lat: number; lng: number; address?: string }
): Promise<EmergencyAlert> {
  const supabase = createClient()

  if (!supabase) {
    console.error('Supabase client not available for creating emergency alert')
    throw new Error('Failed to create emergency alert: Server configuration error')
  }

  const alertData: any = {
    user_id: userId,
    status: 'active',
    alert_type: alertType,
  }

  if (location) {
    alertData.location_lat = location.lat
    alertData.location_lng = location.lng
    if (location.address) {
      alertData.address = location.address
    }
  }

  const { data, error } = await supabase
    .from('emergency_alerts')
    .insert(alertData)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create emergency alert: ${error.message}`)
  }

  return data as EmergencyAlert
}

/**
 * Get user's emergency contacts
 */
export async function getEmergencyContacts(userId: string) {
  const supabase = createClient()

  if (!supabase) {
    console.error('Supabase client not available for fetching emergency contacts')
    throw new Error('Failed to fetch emergency contacts: Server configuration error')
  }

  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('priority', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch emergency contacts: ${error.message}`)
  }

  return data || []
}

/**
 * Send notifications to all emergency contacts
 */
export async function notifyEmergencyContacts(
  alertId: string,
  userId: string,
  contacts: any[]
): Promise<void> {
  const supabase = createClient()

  if (!supabase) {
    console.error('Supabase client not available for notifications')
    throw new Error('Failed to send notifications: Server configuration error')
  }

  try {
    // Filter and get contact IDs
    const contactIds = contacts
      .filter(c => c.verified && (c.contact_user_id || c.email || c.phone))
      .map(c => c.contact_user_id || c.id)

    if (contactIds.length === 0) {
      console.warn('No verified contacts to notify')
      return
    }

    // Update alert with notified contacts
    const { error: updateError } = await supabase
      .from('emergency_alerts')
      .update({ contacts_notified: contactIds })
      .eq('id', alertId)
      .eq('user_id', userId) // Ensure user owns this alert

    if (updateError) {
      console.error('Failed to update alert with notified contacts:', updateError)
      throw new Error(`Failed to update alert: ${updateError.message}`)
    }

    // Create alert responses for each contact
    const responses = contactIds
      .filter(id => id) // Filter out null/undefined
      .map(contactId => ({
        alert_id: alertId,
        contact_user_id: contactId,
      }))

    if (responses.length > 0) {
      const { error: insertError } = await supabase
        .from('alert_responses')
        .insert(responses)

      if (insertError) {
        console.error('Failed to create alert responses:', insertError)
        // Don't throw - alert is already updated with contacts
        // The responses can be created later if needed
      }
    }

    // Push notifications are implemented via Supabase Realtime
    // When emergency_alerts.contacts_notified is updated, Realtime subscriptions
    // on contact users' devices will fire and trigger the alert UI
    // See subscribeToContactAlerts() in lib/realtime/subscriptions.ts
    // The update above (contacts_notified array) triggers Realtime changes
    // Contacts subscribe to emergency_alerts table and filter by their user ID in contacts_notified
  } catch (error: any) {
    console.error('Error notifying emergency contacts:', error)
    throw error
  }
}

/**
 * Cancel an emergency alert
 */
export async function cancelEmergencyAlert(alertId: string, userId: string): Promise<void> {
  const supabase = createClient()

  if (!supabase) {
    console.error('Supabase client not available for cancelling emergency alert')
    throw new Error('Failed to cancel emergency alert: Server configuration error')
  }

  const { error } = await supabase
    .from('emergency_alerts')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to cancel emergency alert: ${error.message}`)
  }
}

/**
 * Resolve an emergency alert
 */
export async function resolveEmergencyAlert(alertId: string, userId: string): Promise<void> {
  const supabase = createClient()

  if (!supabase) {
    console.error('Supabase client not available for resolving emergency alert')
    throw new Error('Failed to resolve emergency alert: Server configuration error')
  }

  const { error } = await supabase
    .from('emergency_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to resolve emergency alert: ${error.message}`)
  }
}

/**
 * Get active emergency alert for a user
 */
export async function getActiveEmergency(userId: string): Promise<EmergencyAlert | null> {
  const supabase = createClient()

  if (!supabase) {
    console.error('Supabase client not available for fetching active emergency')
    throw new Error('Failed to fetch active emergency: Server configuration error')
  }

  // Use .maybeSingle() instead of .single() to handle cases where no active emergency exists
  // .maybeSingle() returns null when no rows found instead of throwing 406 error
  const { data, error } = await supabase
    .from('emergency_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch active emergency: ${error.message}`)
  }

  return data as EmergencyAlert | null
}

/**
 * Rate limit check - max 1 emergency per 30 seconds
 */
export async function checkRateLimit(userId: string): Promise<boolean> {
  const supabase = createClient()

  if (!supabase) {
    console.error('Supabase client not available for rate limit check')
    // Return false (fail-safe) - don't allow emergency if client is unavailable
    return false
  }

  const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString()

  const { data, error } = await supabase
    .from('emergency_alerts')
    .select('id')
    .eq('user_id', userId)
    .gte('triggered_at', thirtySecondsAgo)
    .eq('status', 'active')
    .limit(1)

  if (error) {
    console.error('Rate limit check error:', error)
    return false
  }

  return (data?.length || 0) === 0
}

