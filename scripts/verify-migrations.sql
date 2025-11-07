-- ============================================================================
-- VERIFY MIGRATIONS HAVE BEEN RUN
-- Run this in Supabase SQL Editor to check if the required migrations exist
-- ============================================================================

-- Check if alert_responses policy exists
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'alert_responses' 
  AND policyname = 'Alert creators can view responses for their alerts';

-- Check if location_history policy exists
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'location_history' 
  AND policyname = 'Contacts can view location during emergency';

-- Summary: If both queries return 1 row each, the migrations have been run successfully
-- If either returns 0 rows, that migration still needs to be run

