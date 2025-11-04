'use client'

import { createClient } from '@/lib/supabase'
import { EmergencyAlert } from '@/types/database'

const TIMEOUT_MS = 15000 // 15 seconds timeout

/**
 * Create an emergency alert (client-side replacement for /api/emergency/create)
 * Handles rate limiting, auto-canceling old alerts, and notifying contacts
 */
export async function createEmergencyAlert(
  alertType: 'robbery' | 'house_breaking' | 'car_jacking' | 'accident' | 'other' = 'other',
  location?: { lat: number; lng: number; address?: string }
): Promise<EmergencyAlert> {
  // Wrap the entire operation in a timeout to prevent hanging
  return Promise.race([
    (async () => {
      const supabase = createClient()
      
      if (!supabase) {
        throw new Error('Failed to create emergency alert: Server configuration error')
      }

      // Get authenticated user
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session?.user) {
        throw new Error('Unauthorized - please sign in')
      }

      const userId = session.user.id

      // Validate alert_type
      const validAlertTypes = ['robbery', 'house_breaking', 'car_jacking', 'accident', 'other']
      if (!validAlertTypes.includes(alertType)) {
        throw new Error(`Invalid alert_type. Must be one of: ${validAlertTypes.join(', ')}`)
      }

      // Validate location if provided
      let validatedLocation: { lat: number; lng: number; address?: string } | undefined = undefined
      if (location) {
        if (typeof location.lat === 'number' && typeof location.lng === 'number') {
          // Validate lat/lng ranges
          if (location.lat >= -90 && location.lat <= 90 && location.lng >= -180 && location.lng <= 180) {
            validatedLocation = {
              lat: location.lat,
              lng: location.lng,
              address: location.address || undefined,
            }
          } else {
            console.warn('Invalid location coordinates provided')
          }
        } else {
          console.warn('Invalid location format provided')
        }
      }

      // Get contacts BEFORE creating the alert so we can include them in the INSERT
      // This ensures contacts_notified is set immediately, triggering Realtime subscriptions on INSERT
      let contactIds: string[] = []
      try {
        console.log('[Alert] Fetching contacts for user:', userId)
        const { data: contacts, error: contactsError } = await supabase
          .from('emergency_contacts')
          .select('id, contact_user_id, email, phone, verified')
          .eq('user_id', userId)
          .eq('verified', true)
        
        if (contactsError) {
          console.error('Failed to get contacts before alert creation:', contactsError)
        } else if (contacts && contacts.length > 0) {
          console.log('[Alert] Raw contacts fetched:', contacts.map((c: any) => ({
            id: c.id,
            contact_user_id: c.contact_user_id,
            email: c.email,
            verified: c.verified
          })))
          
          // Filter and get contact USER IDs (not contact record IDs)
          // Add validation to filter out invalid self-references
          contactIds = contacts
            .filter((c: any) => {
              // Must be verified
              if (!c.verified) {
                console.warn('[Alert] Skipping unverified contact:', c.id)
                return false
              }
              // Must have contact_user_id
              if (!c.contact_user_id) {
                console.warn('[Alert] Skipping contact without contact_user_id:', c.id)
                return false
              }
              // contact_user_id must be different from user_id (no self-references)
              if (c.contact_user_id === userId) {
                console.warn('[Alert] Skipping invalid self-reference contact:', c.id, 'contact_user_id equals user_id:', userId)
                return false
              }
              return true
            })
            .map((c: any) => c.contact_user_id)
            .filter((id: any): id is string => !!id)
          
          console.log('[Alert] Final contactIds to notify:', contactIds)
          console.log('[Alert] User triggering alert:', userId)
        } else {
          console.warn('[Alert] No verified contacts found for user:', userId)
        }
      } catch (contactError) {
        console.warn('Failed to get contacts before alert creation (non-critical):', contactError)
      }

      // Use regular client (RLS should allow these operations for the user's own data)
      // Auto-cancel any existing active alerts before creating new one
      let cancelledCount = 0
      try {
        const { data: cancelledData, error: cancelError } = await supabase
          .from('emergency_alerts')
          .update({ 
            status: 'cancelled', 
            resolved_at: new Date().toISOString() 
          })
          .eq('user_id', userId)
          .eq('status', 'active')
          .select('id')
        
        if (cancelError) {
          // Check if it's an RLS violation
          const isRLSError = cancelError.message?.includes('row-level security') || 
                            cancelError.code === '42501' || 
                            cancelError.status === 403
          
          if (isRLSError) {
            console.warn(
              '⚠️ RLS Policy Error: Auto-cancel failed due to missing RLS policy. ' +
              'Please run migrations/fix-all-rls-policies-comprehensive.sql in Supabase SQL Editor. ' +
              'This will not prevent alert creation, but manual cancellation may fail until the migration is run.',
              cancelError
            )
          } else {
            console.warn('Failed to auto-cancel old active alerts (non-critical):', cancelError)
          }
        } else if (cancelledData) {
          cancelledCount = cancelledData.length
          console.log(`Auto-cancelled ${cancelledCount} old active alert(s) for user ${userId}`)
        }
      } catch (cancelErr: any) {
        // Check if it's an RLS violation
        const isRLSError = cancelErr?.message?.includes('row-level security') || 
                          cancelErr?.code === '42501' || 
                          cancelErr?.status === 403
        
        if (isRLSError) {
          console.warn(
            '⚠️ RLS Policy Error: Auto-cancel failed due to missing RLS policy. ' +
            'Please run migrations/fix-all-rls-policies-comprehensive.sql in Supabase SQL Editor. ' +
            'This will not prevent alert creation, but manual cancellation may fail until the migration is run.',
            cancelErr
          )
        } else {
          console.warn('Error auto-cancelling old active alerts (non-critical):', cancelErr)
        }
      }

      // Check rate limit - checks only active alerts (old ones were auto-cancelled above)
      try {
        const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString()
        
        const { data: rateLimitData, error: rateLimitError } = await supabase
          .from('emergency_alerts')
          .select('id, triggered_at')
          .eq('user_id', userId)
          .eq('status', 'active')
          .gte('triggered_at', thirtySecondsAgo)
          .limit(1)
        
        if (rateLimitError) {
          console.error('Rate limit check error:', rateLimitError)
        } else if (rateLimitData && rateLimitData.length > 0) {
          throw new Error('Rate limit exceeded. Please wait 30 seconds.')
        }
      } catch (rateLimitError: any) {
        if (rateLimitError.message.includes('Rate limit')) {
          throw rateLimitError
        }
        console.error('Rate limit check error:', rateLimitError)
      }

      // Create emergency alert using regular client
      // Include contacts_notified in initial INSERT so Realtime subscriptions fire immediately
      const alertData: any = {
        user_id: userId,
        status: 'active',
        alert_type: alertType,
      }

      // Include contacts_notified in initial insert so contacts receive alert immediately via Realtime
      if (contactIds.length > 0) {
        alertData.contacts_notified = contactIds
      }

      if (validatedLocation) {
        alertData.location_lat = validatedLocation.lat
        alertData.location_lng = validatedLocation.lng
        if (validatedLocation.address) {
          alertData.address = validatedLocation.address
        }
      }

      const { data: alertDataResult, error: alertError } = await supabase
        .from('emergency_alerts')
        .insert(alertData)
        .select()
        .single()

      if (alertError || !alertDataResult) {
        console.error('Failed to create emergency alert:', alertError)
        throw new Error(alertError?.message || 'Failed to create emergency alert')
      }

      const alert = alertDataResult as EmergencyAlert

      // Contacts are already notified via contacts_notified in the INSERT above
      // This ensures Realtime subscriptions fire immediately on INSERT event
      // No need for separate UPDATE - contacts will receive the alert via Realtime
      if (alert.contacts_notified && Array.isArray(alert.contacts_notified) && alert.contacts_notified.length > 0) {
        console.log(`Alert created with ${alert.contacts_notified.length} contact(s) notified via Realtime subscription.`)
      } else {
        console.warn('Alert created but no contacts were notified. Make sure you have verified contacts.')
      }

      return alert
    })(),
    new Promise<EmergencyAlert>((_, reject) => 
      setTimeout(() => reject(new Error('Alert creation timed out after 15 seconds. Please check your connection and try again.')), TIMEOUT_MS)
    )
  ])
}

/**
 * Cancel an emergency alert (client-side replacement for /api/emergency/cancel)
 * Note: RLS policy may restrict updates. If this fails, the alert may already be cancelled
 * or the RLS policy needs to be adjusted.
 */
export async function cancelEmergencyAlert(alertId: string): Promise<void> {
  const supabase = createClient()
  
  if (!supabase) {
    throw new Error('Failed to cancel emergency alert: Server configuration error')
  }

  // Get authenticated user
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  
  if (sessionError || !session?.user) {
    throw new Error('Unauthorized - please sign in')
  }

  const userId = session.user.id

  // First, check if the alert exists and is active
  const { data: alert, error: fetchError } = await supabase
    .from('emergency_alerts')
    .select('id, status, user_id')
    .eq('id', alertId)
    .eq('user_id', userId)
    .single()

  if (fetchError || !alert) {
    throw new Error('Alert not found or you do not have permission to cancel it')
  }

  // If already cancelled, consider it successful
  if (alert.status === 'cancelled') {
    console.log('Alert already cancelled')
    return
  }

  // Try to update - RLS policy allows updating when status = 'active'
  // Note: The RLS policy needs a WITH CHECK clause to allow updates to 'cancelled'
  // If this fails, we'll gracefully handle it by re-checking the alert status
  const { error, data } = await supabase
    .from('emergency_alerts')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('user_id', userId)
    .eq('status', 'active') // Only update if currently active
    .select()

  if (error) {
    // Check if it's an RLS violation
    const isRLSError = error.message?.includes('row-level security') || 
                      error.code === '42501' || 
                      error.status === 403
    
    if (isRLSError) {
      // RLS policy likely missing WITH CHECK clause
      // Instead of throwing an error, gracefully re-check the alert status
      // The alert might have been cancelled by another process or auto-cancelled
      console.warn('RLS policy blocked update. Re-checking alert status...')
      
      // Re-fetch the alert to check its current status
      const { data: currentAlert, error: recheckError } = await supabase
        .from('emergency_alerts')
        .select('id, status, user_id')
        .eq('id', alertId)
        .eq('user_id', userId)
        .single()
      
      if (recheckError || !currentAlert) {
        // Can't verify status - provide helpful error but don't crash
        console.error('Failed to verify alert status after RLS error:', recheckError)
        throw new Error(
          'Unable to cancel alert due to database policy. ' +
          'The alert may have already been cancelled. Please refresh the page to see the current status. ' +
          'To permanently fix this, run migrations/fix-all-rls-policies-comprehensive.sql in Supabase SQL Editor.'
        )
      }
      
      // If alert is already cancelled or not active, consider it successful
      if (currentAlert.status === 'cancelled' || currentAlert.status !== 'active') {
        console.log(`Alert is already ${currentAlert.status} - treating as successful cancellation`)
        return // Success - alert is no longer active
      }
      
      // Alert is still active but RLS blocked the update
      // This is a real issue - but provide a user-friendly message
      console.error('RLS policy blocked cancellation but alert is still active')
      throw new Error(
        'Unable to cancel alert due to database policy. ' +
        'Please refresh the page and try again. ' +
        'If this persists, run migrations/fix-all-rls-policies-comprehensive.sql in Supabase SQL Editor.'
      )
    }
    
    // Non-RLS error - check if alert is still active
    if (alert.status !== 'active') {
      console.log(`Alert is already ${alert.status}`)
      return // Consider it successful
    }
    
    throw new Error(`Failed to cancel emergency alert: ${error.message}`)
  }
  
  // Check if update actually succeeded
  if (!data || data.length === 0) {
    // Update returned no rows - re-check alert status
    console.warn('Update returned no rows. Re-checking alert status...')
    
    const { data: currentAlert, error: recheckError } = await supabase
      .from('emergency_alerts')
      .select('id, status, user_id')
      .eq('id', alertId)
      .eq('user_id', userId)
      .single()
    
    if (recheckError || !currentAlert) {
      throw new Error('Failed to cancel alert: Unable to verify alert status')
    }
    
    // If alert is no longer active, consider it successful
    if (currentAlert.status === 'cancelled' || currentAlert.status !== 'active') {
      console.log(`Alert is already ${currentAlert.status} - treating as successful cancellation`)
      return // Success
    }
    
    // Alert is still active - this is a real failure
    throw new Error('Failed to cancel alert: No rows were updated and alert is still active')
  }
}

