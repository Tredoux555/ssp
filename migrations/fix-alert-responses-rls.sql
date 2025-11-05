-- ============================================================================
-- FIX ALERT_RESPONSES RLS POLICY
-- Allow alert creators to create responses for their contacts
-- ============================================================================

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Alert creators can create responses for contacts" ON alert_responses;

-- Create policy that allows alert creators to insert responses for their contacts
-- This allows User A to create alert_responses for User B when User A creates an alert
CREATE POLICY "Alert creators can create responses for contacts" ON alert_responses
  FOR INSERT WITH CHECK (
    -- Allow if the alert creator owns the alert and the contact is in contacts_notified
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id = alert_responses.alert_id
      AND ea.user_id = auth.uid()
      AND alert_responses.contact_user_id::text = ANY(ea.contacts_notified)
    )
  );

-- Also keep the existing policy for contacts to create their own responses
-- (This should already exist, but let's make sure)
DROP POLICY IF EXISTS "Contacts can create own responses" ON alert_responses;
CREATE POLICY "Contacts can create own responses" ON alert_responses
  FOR INSERT WITH CHECK (auth.uid() = contact_user_id);

