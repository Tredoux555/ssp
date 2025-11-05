# Debugging Guide: Emergency Alerts Not Showing on Linked Accounts

## Step 1: Run the Comprehensive Fix Migration

First, run the comprehensive fix migration in Supabase SQL Editor:
```sql
-- Run: migrations/fix-emergency-alerts-comprehensive.sql
```

This will:
- Enable Realtime for `emergency_alerts` table
- Fix RLS policies to allow contacts to view alerts
- Add indexes for performance
- Create a diagnostic function

## Step 2: Check Browser Console Logs

When an alert is created, check the browser console on:
1. **Alert creator's device** - Look for:
   - `[Alert] ✅ Alert created with X contact(s) in contacts_notified array`
   - `[Alert] 📋 Contacts to be notified (EXACT IDs): [...]`
   - `[Alert] ✅ Verified alert in database`

2. **Contact's device** - Look for:
   - `[Realtime] 📨 Contact alert event received for user`
   - `[Realtime] 🔍 Checking if user is notified`
   - `[Realtime] ✅ TRIGGERING CALLBACK` (if real-time works)
   - `[Dashboard] 🔍 Checking X active alerts for user`
   - `[Dashboard] ✅ Found alert for user` (if polling works)

## Step 3: Run Diagnostic Queries

Run these queries in Supabase SQL Editor to diagnose:

### Check if contacts are properly set up:
```sql
SELECT 
  ec1.user_id as user_a_id,
  ec1.contact_user_id as user_b_id,
  ec1.verified as a_to_b_verified,
  ec2.verified as b_to_a_verified
FROM emergency_contacts ec1
LEFT JOIN emergency_contacts ec2 
  ON ec1.contact_user_id = ec2.user_id 
  AND ec1.user_id = ec2.contact_user_id
WHERE ec1.verified = true;
```

### Check active alerts and their contacts_notified:
```sql
SELECT 
  ea.id,
  ea.user_id,
  ea.contacts_notified,
  ea.status,
  ea.triggered_at
FROM emergency_alerts ea
WHERE ea.status = 'active'
ORDER BY ea.triggered_at DESC;
```

### Check if a specific user can see an alert (replace USER_ID and ALERT_ID):
```sql
SELECT * FROM check_alert_visibility(
  'ALERT_ID_HERE'::uuid,
  'USER_ID_HERE'::uuid
);
```

### Check if Realtime is enabled:
```sql
SELECT 
  pt.tablename,
  p.pubname
FROM pg_publication_tables pt
JOIN pg_publication p ON pt.pubname = p.pubname
WHERE pt.tablename = 'emergency_alerts';
```

## Step 4: Verify RLS Policies

Check that the policies exist:
```sql
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'emergency_alerts'
AND (policyname LIKE '%notified%' OR policyname LIKE '%response%');
```

You should see:
- "Contacts can view notified alerts"
- "Contacts can view alerts via responses"

## Step 5: Test Alert Creation

1. Create an alert from User A
2. Check console logs on both devices
3. Run diagnostic queries to verify:
   - Alert was created with `contacts_notified` populated
   - Contact User B can SELECT the alert (RLS allows it)
   - `alert_responses` were created for User B

## Step 6: Check Real-time Subscription

In the contact's browser console, you should see:
- `[Realtime] ✅ Successfully subscribed to contact-alerts-USER_ID`
- `[Realtime] Subscription status for contact-alerts-USER_ID: SUBSCRIBED`

If you see `TIMED_OUT` or `CHANNEL_ERROR`, Realtime might not be enabled or there's a connection issue.

## Step 7: Verify Polling is Working

The polling mechanism should find alerts even if Realtime fails. Check console for:
- `[Dashboard] 📡 Starting fallback polling`
- `[Dashboard] 🔍 Checking X active alerts for user`
- `[Dashboard] ✅ Found alert for user` (if alert is found)

## Common Issues

### Issue 1: Contacts_notified is empty
**Cause**: No verified contacts with `contact_user_id` set
**Fix**: Ensure contacts are verified and have `contact_user_id` (not just email/phone)

### Issue 2: RLS policy blocking access
**Cause**: Old restrictive policy still in place
**Fix**: Run the comprehensive fix migration

### Issue 3: Realtime not enabled
**Cause**: Table not in Realtime publication
**Fix**: Run the comprehensive fix migration (it enables Realtime)

### Issue 4: UUID vs TEXT mismatch
**Cause**: `contacts_notified` contains UUIDs but comparison uses TEXT (or vice versa)
**Fix**: The RLS policy uses `auth.uid()::text = ANY(emergency_alerts.contacts_notified)` to handle this

### Issue 5: Subscription not receiving events
**Cause**: RLS blocking SELECT, or subscription not properly set up
**Fix**: 
- Verify RLS policy allows SELECT
- Check subscription status in console
- Polling should still work as fallback

## Next Steps

If alerts still don't show after following these steps:
1. Share the console logs from both devices
2. Share the results of diagnostic queries
3. Check if `alert_responses` table has entries for the contact user
4. Verify the contact relationship is bidirectional and verified

