-- Fix RLS policy for emergency_alerts to allow users to cancel their own alerts
-- This migration adds a WITH CHECK clause to allow updates from 'active' to 'cancelled'

-- Drop the existing policy
DROP POLICY IF EXISTS "Users can update own alerts" ON emergency_alerts;

-- Recreate the policy with both USING and WITH CHECK clauses
-- USING: checks the OLD row (must be active)
-- WITH CHECK: checks the NEW row (allows 'cancelled' or 'resolved' status)
CREATE POLICY "Users can update own alerts" ON emergency_alerts
  FOR UPDATE 
  USING (auth.uid() = user_id AND status = 'active')
  WITH CHECK (
    auth.uid() = user_id 
    AND (
      status = 'cancelled' 
      OR status = 'resolved' 
      OR status = 'active'
    )
  );

-- Alternative: If you want to allow updates to any status for own alerts, use:
-- CREATE POLICY "Users can update own alerts" ON emergency_alerts
--   FOR UPDATE 
--   USING (auth.uid() = user_id)
--   WITH CHECK (auth.uid() = user_id);

