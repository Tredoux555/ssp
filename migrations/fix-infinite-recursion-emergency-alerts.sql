-- ============================================================================
-- FIX INFINITE RECURSION IN EMERGENCY_ALERTS RLS POLICY
-- ============================================================================
-- This migration fixes the "infinite recursion detected in policy for relation emergency_alerts" error
-- 
-- Problem: The "Contacts can view alerts via responses" policy creates a circular dependency:
--   - emergency_alerts policy queries alert_responses
--   - alert_responses policy queries emergency_alerts
--   - This causes infinite recursion during INSERT operations
--
-- Solution: Drop the redundant policy. The main "Contacts can view notified alerts" policy
--   already handles access via contacts_notified array, so this backup policy isn't needed.

-- Drop the problematic policy that causes circular dependency
DROP POLICY IF EXISTS "Contacts can view alerts via responses" ON emergency_alerts;

