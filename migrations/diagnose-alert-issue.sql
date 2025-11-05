-- ============================================================================
-- DIAGNOSTIC QUERIES FOR EMERGENCY ALERT ISSUE
-- Run these queries to diagnose why alerts aren't showing on linked accounts
-- ============================================================================

-- 1. Check if RLS policies exist and are correct
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
WHERE tablename = 'emergency_alerts'
ORDER BY policyname;

-- 2. Check if contacts are properly set up and bidirectional
SELECT 
  ec1.user_id as user_a_id,
  ec1.contact_user_id as user_b_id,
  ec1.verified as a_to_b_verified,
  ec2.user_id as user_b_id_check,
  ec2.contact_user_id as user_a_id_check,
  ec2.verified as b_to_a_verified,
  CASE 
    WHEN ec2.id IS NULL THEN 'MISSING REVERSE CONTACT'
    WHEN ec2.verified = false THEN 'REVERSE CONTACT NOT VERIFIED'
    ELSE 'BIDIRECTIONAL OK'
  END as relationship_status
FROM emergency_contacts ec1
LEFT JOIN emergency_contacts ec2 
  ON ec1.contact_user_id = ec2.user_id 
  AND ec1.user_id = ec2.contact_user_id
WHERE ec1.verified = true
ORDER BY ec1.user_id;

-- 3. Check active alerts and their contacts_notified
SELECT 
  ea.id as alert_id,
  ea.user_id as alert_user_id,
  ea.status,
  ea.contacts_notified,
  array_length(ea.contacts_notified, 1) as contacts_count,
  ea.triggered_at,
  -- Check if contacts exist for each notified contact
  (
    SELECT COUNT(*) 
    FROM emergency_contacts ec
    WHERE ec.user_id = ea.user_id
    AND ec.contact_user_id::text = ANY(ea.contacts_notified)
    AND ec.verified = true
  ) as verified_contacts_count
FROM emergency_alerts ea
WHERE ea.status = 'active'
ORDER BY ea.triggered_at DESC;

-- 4. Check if a specific user can see alerts (replace USER_ID_HERE with actual user ID)
-- This simulates what the RLS policy would allow
SELECT 
  ea.*,
  'USER_ID_HERE'::text = ANY(ea.contacts_notified) as user_in_contacts_notified,
  EXISTS (
    SELECT 1 FROM emergency_contacts ec
    WHERE ec.user_id = ea.user_id
    AND ec.contact_user_id = 'USER_ID_HERE'::uuid
    AND ec.verified = true
  ) as contact_relationship_exists
FROM emergency_alerts ea
WHERE ea.status = 'active'
AND (
  'USER_ID_HERE'::text = ANY(ea.contacts_notified)
  OR EXISTS (
    SELECT 1 FROM emergency_contacts ec
    WHERE ec.user_id = ea.user_id
    AND ec.contact_user_id = 'USER_ID_HERE'::uuid
    AND ec.verified = true
  )
);

-- 5. Check if Realtime is enabled for emergency_alerts table
SELECT 
  schemaname,
  tablename,
  REPLICA IDENTITY
FROM pg_tables 
WHERE tablename = 'emergency_alerts';

-- Check publication (Realtime uses publications)
SELECT 
  pubname,
  puballtables,
  pubinsert,
  pubupdate,
  pubdelete,
  pubtruncate
FROM pg_publication 
WHERE pubname LIKE '%supabase_realtime%' OR pubname = 'supabase_realtime';

-- Check if emergency_alerts is in the publication
SELECT 
  p.pubname,
  pt.schemaname,
  pt.tablename
FROM pg_publication p
JOIN pg_publication_tables pt ON p.pubname = pt.pubname
WHERE pt.tablename = 'emergency_alerts';

