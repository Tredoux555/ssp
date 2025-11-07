-- ============================================================================
-- FIX LOCATION SHARING RLS POLICY
-- Allow bidirectional location viewing during active emergencies
-- ============================================================================

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Contacts can view location during emergency" ON location_history;

-- Create new policy that allows bidirectional location viewing
-- This policy allows:
-- 1. Users to see their own locations (always)
-- 2. Receivers to see sender's location (if they're notified about the alert)
-- 3. Sender to see receiver's location (if receiver has accepted to respond)
CREATE POLICY "Contacts can view location during emergency" ON location_history
  FOR SELECT USING (
    -- Always allow users to see their own locations
    auth.uid() = user_id
    OR
    -- Allow viewing locations for active alerts
    (
      alert_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM emergency_alerts ea
        WHERE ea.id = location_history.alert_id
        AND ea.status = 'active'
      )
      AND (
        -- Case 1: Receiver viewing sender's location
        -- Location belongs to alert creator AND receiver is in contacts_notified
        (
          location_history.user_id = (
            SELECT user_id FROM emergency_alerts WHERE id = location_history.alert_id
          )
          AND EXISTS (
            SELECT 1 FROM emergency_alerts ea
            WHERE ea.id = location_history.alert_id
            AND auth.uid()::text = ANY(ea.contacts_notified)
          )
        )
        OR
        -- Case 2: Sender viewing receiver's location
        -- Location belongs to a receiver AND receiver has accepted AND sender is alert creator
        (
          location_history.user_id != (
            SELECT user_id FROM emergency_alerts WHERE id = location_history.alert_id
          )
          AND EXISTS (
            SELECT 1 FROM emergency_alerts ea
            WHERE ea.id = location_history.alert_id
            AND ea.user_id = auth.uid()
          )
          AND EXISTS (
            SELECT 1 FROM alert_responses ar
            WHERE ar.alert_id = location_history.alert_id
            AND ar.contact_user_id = location_history.user_id
            AND ar.acknowledged_at IS NOT NULL
          )
        )
      )
    )
  );

