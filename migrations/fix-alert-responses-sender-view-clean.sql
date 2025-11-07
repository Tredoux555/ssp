-- FIX ALERT_RESPONSES RLS POLICY - Allow senders to view responses
-- This migration allows alert creators (senders) to query alert_responses
-- to see which contacts have accepted to respond to their alerts.
-- Without this policy, senders cannot see who has accepted, preventing
-- location sharing from working properly.

CREATE POLICY "Alert creators can view responses for their alerts" ON alert_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id = alert_responses.alert_id
      AND ea.user_id = auth.uid()
    )
  );

