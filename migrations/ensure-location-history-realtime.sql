-- ============================================================================
-- Ensure location_history table is in Realtime publication
-- This enables real-time location updates for receivers
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Add location_history to Realtime publication if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'location_history'
  ) THEN
    -- Add table to Realtime publication
    ALTER PUBLICATION supabase_realtime ADD TABLE location_history;
    RAISE NOTICE 'Added location_history to Realtime publication';
  ELSE
    RAISE NOTICE 'location_history already in Realtime publication';
  END IF;
END $$;

-- Verify the table is in the publication
SELECT 
  tablename,
  'location_history' as expected_table
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
AND tablename = 'location_history';

