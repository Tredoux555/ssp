-- FIX INFINITE RECURSION IN EMERGENCY_ALERTS RLS POLICY
-- Drop the problematic policy that causes circular dependency

DROP POLICY IF EXISTS "Contacts can view alerts via responses" ON emergency_alerts;

