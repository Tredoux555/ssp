# Alert Sync Diagnostic Guide

## Problem
Alerts are not showing up on contact devices despite verified contacts.

## Root Causes to Check

### 1. Realtime Not Enabled
Supabase Realtime must be enabled for the `emergency_alerts` table:
- Go to Supabase Dashboard
- Database → Replication
- Enable Realtime for `emergency_alerts` table

### 2. Contact Relationship Verification
Run this SQL in Supabase SQL Editor to verify bidirectional contacts:

```sql
-- Check if contacts exist and are bidirectional
SELECT 
  ec1.user_id as user_a_id,
  ec1.contact_user_id as user_b_id,
  ec1.verified as a_to_b_verified,
  ec2.user_id as user_b_id_check,
  ec2.contact_user_id as user_a_id_check,
  ec2.verified as b_to_a_verified
FROM emergency_contacts ec1
LEFT JOIN emergency_contacts ec2 
  ON ec1.contact_user_id = ec2.user_id 
  AND ec1.user_id = ec2.contact_user_id
WHERE ec1.verified = true
ORDER BY ec1.user_id;
```

### 3. Check Active Alerts
Run this to see what alerts exist and their contacts_notified:

```sql
SELECT 
  id,
  user_id,
  status,
  contacts_notified,
  triggered_at
FROM emergency_alerts
WHERE status = 'active'
ORDER BY triggered_at DESC;
```

### 4. Verify Contact IDs Match
The `contact_user_id` in `emergency_contacts` must match the user IDs in `contacts_notified`:

```sql
-- Check if contact IDs in contacts_notified match actual user IDs
SELECT 
  ea.id as alert_id,
  ea.user_id as alert_user_id,
  ea.contacts_notified,
  ec.contact_user_id,
  ec.verified
FROM emergency_alerts ea
CROSS JOIN LATERAL unnest(ea.contacts_notified) AS contact_id
LEFT JOIN emergency_contacts ec 
  ON ec.user_id = ea.user_id 
  AND ec.contact_user_id::text = contact_id
WHERE ea.status = 'active';
```

## Quick Fixes

### Enable Realtime (Critical!)
1. Go to Supabase Dashboard
2. Database → Replication
3. Find `emergency_alerts` table
4. Toggle Realtime ON
5. Save

### Test Query
Run this to manually test if alerts should be visible:

```sql
-- Get alerts for a specific user (replace USER_ID with actual user ID)
SELECT ea.*
FROM emergency_alerts ea
WHERE ea.status = 'active'
  AND 'USER_ID' = ANY(ea.contacts_notified);
```

