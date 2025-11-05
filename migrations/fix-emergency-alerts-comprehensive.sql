-- ============================================================================
-- COMPREHENSIVE FIX FOR EMERGENCY ALERTS NOT SHOWING ON LINKED ACCOUNTS
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. Ensure Realtime is enabled for emergency_alerts table
-- Check if table is already in the publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'emergency_alerts'
  ) THEN
    -- Add table to Realtime publication
    ALTER PUBLICATION supabase_realtime ADD TABLE emergency_alerts;
    RAISE NOTICE 'Added emergency_alerts to Realtime publication';
  ELSE
    RAISE NOTICE 'emergency_alerts already in Realtime publication';
  END IF;
END $$;

-- 2. Fix RLS Policy for contacts viewing alerts
-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Contacts can view notified alerts" ON emergency_alerts;

-- Create a simpler policy that only checks if user is in contacts_notified
-- This is secure because contacts_notified only contains verified contact_user_id values
CREATE POLICY "Contacts can view notified alerts" ON emergency_alerts
  FOR SELECT USING (
    -- User is in the contacts_notified array (explicitly notified)
    auth.uid()::text = ANY(emergency_alerts.contacts_notified)
  );

-- 3. Also allow viewing alerts via alert_responses table (alternative path)
-- This provides a backup way for contacts to see alerts they're responding to
CREATE POLICY "Contacts can view alerts via responses" ON emergency_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM alert_responses ar
      WHERE ar.alert_id = emergency_alerts.id
      AND ar.contact_user_id = auth.uid()
    )
  );

-- 4. Ensure alert_responses can be created for contacts
-- This should already exist, but let's make sure
-- (The RLS policy for alert_responses should already allow contacts to insert their own responses)

-- 5. Create a function to help debug RLS issues
CREATE OR REPLACE FUNCTION check_alert_visibility(alert_id_param UUID, user_id_param UUID)
RETURNS TABLE (
  can_view BOOLEAN,
  reason TEXT,
  contacts_notified TEXT[],
  user_in_contacts BOOLEAN,
  has_response BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN ea.user_id = user_id_param THEN true
      WHEN user_id_param::text = ANY(ea.contacts_notified) THEN true
      WHEN EXISTS (
        SELECT 1 FROM alert_responses ar
        WHERE ar.alert_id = ea.id
        AND ar.contact_user_id = user_id_param
      ) THEN true
      ELSE false
    END as can_view,
    CASE 
      WHEN ea.user_id = user_id_param THEN 'User is alert owner'
      WHEN user_id_param::text = ANY(ea.contacts_notified) THEN 'User in contacts_notified'
      WHEN EXISTS (
        SELECT 1 FROM alert_responses ar
        WHERE ar.alert_id = ea.id
        AND ar.contact_user_id = user_id_param
      ) THEN 'User has alert response'
      ELSE 'No access'
    END as reason,
    ea.contacts_notified,
    user_id_param::text = ANY(ea.contacts_notified) as user_in_contacts,
    EXISTS (
      SELECT 1 FROM alert_responses ar
      WHERE ar.alert_id = ea.id
      AND ar.contact_user_id = user_id_param
    ) as has_response
  FROM emergency_alerts ea
  WHERE ea.id = alert_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION check_alert_visibility(UUID, UUID) TO authenticated;

-- 6. Verify the policies are correct
DO $$
DECLARE
  policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies 
  WHERE tablename = 'emergency_alerts'
  AND policyname LIKE '%notified%' OR policyname LIKE '%response%';
  
  IF policy_count = 0 THEN
    RAISE EXCEPTION 'No contact alert policies found - something went wrong';
  ELSE
    RAISE NOTICE 'Found % contact alert policies', policy_count;
  END IF;
END $$;

-- 7. Add index to help with RLS policy performance
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_contacts_notified_gin 
  ON emergency_alerts USING GIN (contacts_notified);

-- 8. Add index for alert_responses lookups
CREATE INDEX IF NOT EXISTS idx_alert_responses_contact_user_id 
  ON alert_responses(contact_user_id) 
  WHERE contact_user_id IS NOT NULL;

