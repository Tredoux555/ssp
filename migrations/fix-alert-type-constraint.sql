-- ============================================================================
-- FIX ALERT_TYPE CHECK CONSTRAINT
-- Update emergency_alerts CHECK constraint to include new alert types
-- ============================================================================

-- Drop the existing CHECK constraint
ALTER TABLE emergency_alerts DROP CONSTRAINT IF EXISTS emergency_alerts_alert_type_check;

-- Add new CHECK constraint with original alert types
ALTER TABLE emergency_alerts 
  ADD CONSTRAINT emergency_alerts_alert_type_check 
  CHECK (alert_type IN ('robbery', 'house_breaking', 'car_jacking', 'accident', 'other'));

