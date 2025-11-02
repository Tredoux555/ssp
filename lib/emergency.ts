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

  const contactIds = contacts
    .filter(c => c.verified && (c.contact_user_id || c.email || c.phone))
    .map(c => c.contact_user_id || c.id)

  // Update alert with notified contacts
  await supabase
    .from('emergency_alerts')
    .update({ contacts_notified: contactIds })
    .eq('id', alertId)

  // Create alert responses for each contact
  const responses = contactIds.map(contactId => ({
    alert_id: alertId,
    contact_user_id: contactId,
  }))

  if (responses.length > 0) {
    await supabase
      .from('alert_responses')
      .insert(responses)
  }

  // TODO: Implement actual push notifications via Supabase Edge Functions or external service
}

/**
 * Cancel an emergency alert
 */
export async function cancelEmergencyAlert(alertId: string, userId: string): Promise<void> {
  const supabase = createClient()

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

  const { data, error } = await supabase
    .from('emergency_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('triggered_at', { ascending: false })
    .limit(1)
    .single()

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

