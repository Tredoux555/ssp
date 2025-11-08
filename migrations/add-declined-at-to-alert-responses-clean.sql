-- Add declined_at field to alert_responses table
-- This allows receivers to decline alerts, which will hide them from the sender's map

ALTER TABLE alert_responses 
ADD COLUMN IF NOT EXISTS declined_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_alert_responses_declined_at 
ON alert_responses(declined_at) 
WHERE declined_at IS NOT NULL;

