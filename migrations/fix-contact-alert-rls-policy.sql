-- ============================================================================
-- FIX RLS POLICY FOR CONTACTS VIEWING EMERGENCY ALERTS
-- This fixes the issue where emergency alerts aren't showing up on linked accounts
-- ============================================================================
-- 
-- Problem: The original policy required both a contact relationship AND the user
-- to be in contacts_notified. This was redundant and could block valid access
-- if the contact relationship check failed for any reason.
--
-- Solution: Simplify the policy to check if the user is in contacts_notified.
-- Since contacts_notified is only populated with verified contact_user_id values,
-- this is sufficient for security while allowing real-time subscriptions to work.

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Contacts can view notified alerts" ON emergency_alerts;

-- Create a simpler policy that checks if user is in contacts_notified array
-- This allows real-time subscriptions to receive events for alerts where the user is notified
CREATE POLICY "Contacts can view notified alerts" ON emergency_alerts
  FOR SELECT USING (
    -- User is in the contacts_notified array (explicitly notified)
    auth.uid()::text = ANY(emergency_alerts.contacts_notified)
  );

-- Note: This policy is simpler and more permissive, but since contacts_notified
-- is only populated with verified contact_user_id values from emergency_contacts,
-- it's still secure. The alert creator explicitly chose to notify these users.

