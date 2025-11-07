-- ============================================================================
-- CHECK IF ALERT_RESPONSES SENDER VIEW POLICY EXISTS
-- Run this to verify the migration was applied
-- ============================================================================

-- Check if the policy exists
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'alert_responses' 
  AND policyname = 'Alert creators can view responses for their alerts';

-- If this returns 0 rows, the migration needs to be run
-- If it returns 1 row, the policy exists and should work

-- Also list all policies on alert_responses for reference
SELECT 
  policyname,
  cmd,
  permissive
FROM pg_policies 
WHERE tablename = 'alert_responses'
ORDER BY policyname;

