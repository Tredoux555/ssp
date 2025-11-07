# CRITICAL: Database Migrations Required for Location Sharing

## Overview
Location sharing between sender and receiver requires two RLS (Row Level Security) policies to be created in Supabase. Without these migrations, the sender cannot see who has accepted to respond, and location sharing will not work.

## Required Migrations

### 1. Allow Senders to View Alert Responses
**File**: `migrations/fix-alert-responses-sender-view.sql`

**Purpose**: Allows alert creators (senders) to query the `alert_responses` table to see which contacts have accepted to respond to their alerts.

**SQL to Run in Supabase SQL Editor**:
```sql
-- ============================================================================
-- FIX ALERT_RESPONSES RLS POLICY - Allow senders to view responses
-- ============================================================================
-- This migration allows alert creators (senders) to query alert_responses
-- to see which contacts have accepted to respond to their alerts.
-- Without this policy, senders cannot see who has accepted, preventing
-- location sharing from working properly.

-- Add policy that allows alert creators to view responses for their alerts
CREATE POLICY "Alert creators can view responses for their alerts" ON alert_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id = alert_responses.alert_id
      AND ea.user_id = auth.uid()
    )
  );
```

**How to Run**:
1. Go to your Supabase Dashboard
2. Navigate to SQL Editor
3. Create a new query
4. Copy and paste the SQL above
5. Click "Run" or press Cmd/Ctrl + Enter

### 2. Allow Bidirectional Location Viewing
**File**: `migrations/fix-location-sharing-rls.sql`

**Purpose**: Allows bidirectional location viewing during active emergencies:
- Receivers can see sender's location (if they're notified about the alert)
- Sender can see receiver's location (if receiver has accepted to respond)

**SQL to Run in Supabase SQL Editor**:
```sql
-- ============================================================================
-- FIX LOCATION SHARING RLS POLICY
-- Allow bidirectional location viewing during active emergencies
-- ============================================================================

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Contacts can view location during emergency" ON location_history;

-- Create new policy that allows bidirectional location viewing
-- This policy allows:
-- 1. Users to see their own locations (always)
-- 2. Receivers to see sender's location (if they're notified about the alert)
-- 3. Sender to see receiver's location (if receiver has accepted to respond)
CREATE POLICY "Contacts can view location during emergency" ON location_history
  FOR SELECT USING (
    -- Always allow users to see their own locations
    auth.uid() = user_id
    OR
    -- Allow viewing locations for active alerts
    (
      alert_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM emergency_alerts ea
        WHERE ea.id = location_history.alert_id
        AND ea.status = 'active'
      )
      AND (
        -- Case 1: Receiver viewing sender's location
        -- Location belongs to alert creator AND receiver is in contacts_notified
        (
          location_history.user_id = (
            SELECT user_id FROM emergency_alerts WHERE id = location_history.alert_id
          )
          AND EXISTS (
            SELECT 1 FROM emergency_alerts ea
            WHERE ea.id = location_history.alert_id
            AND auth.uid()::text = ANY(ea.contacts_notified)
          )
        )
        OR
        -- Case 2: Sender viewing receiver's location
        -- Location belongs to a receiver AND receiver has accepted AND sender is alert creator
        (
          location_history.user_id != (
            SELECT user_id FROM emergency_alerts WHERE id = location_history.alert_id
          )
          AND EXISTS (
            SELECT 1 FROM emergency_alerts ea
            WHERE ea.id = location_history.alert_id
            AND ea.user_id = auth.uid()
          )
          AND EXISTS (
            SELECT 1 FROM alert_responses ar
            WHERE ar.alert_id = location_history.alert_id
            AND ar.contact_user_id = location_history.user_id
            AND ar.acknowledged_at IS NOT NULL
          )
        )
      )
    )
  );
```

**How to Run**:
1. Go to your Supabase Dashboard
2. Navigate to SQL Editor
3. Create a new query
4. Copy and paste the SQL above
5. Click "Run" or press Cmd/Ctrl + Enter

## Verification

After running both migrations, you can verify they were created successfully:

### Option 1: Using SQL Query (Recommended)
1. Go to Supabase Dashboard → SQL Editor
2. Run the verification script: `scripts/verify-migrations.sql`
3. Both queries should return 1 row each
4. If either returns 0 rows, that migration still needs to be run

### Option 2: Using Dashboard
1. Go to Supabase Dashboard → Authentication → Policies
2. Find the `alert_responses` table
3. You should see a policy named "Alert creators can view responses for their alerts"
4. Find the `location_history` table
5. You should see a policy named "Contacts can view location during emergency"

## Testing

After running the migrations:

1. **Sender creates alert**: Alert should be created successfully
2. **Receiver receives alert**: Receiver should see the alert notification
3. **Receiver accepts**: Receiver clicks "Accept to Respond"
4. **Sender sees acceptance**: Within 3-5 seconds, sender should see:
   - Accepted responder count increase
   - Receiver's location appear on the map
5. **Receiver sees sender**: Receiver should see sender's location on their map
6. **Both locations update**: Both locations should update in real-time

## Troubleshooting

If location sharing still doesn't work after running migrations:

1. **Check console logs** for RLS errors:
   - Look for `[Sender] ❌ RLS policy blocking` messages
   - If you see these, the migrations may not have been applied correctly

2. **Verify policies exist**:
   - Go to Supabase Dashboard → SQL Editor
   - Run: `SELECT * FROM pg_policies WHERE tablename = 'alert_responses';`
   - Run: `SELECT * FROM pg_policies WHERE tablename = 'location_history';`
   - You should see the new policies listed

3. **Check for duplicate policies**:
   - If you see duplicate policies, you may need to drop the old one first
   - Use: `DROP POLICY IF EXISTS "old_policy_name" ON table_name;`

## Important Notes

- These migrations are **REQUIRED** for location sharing to work
- Without them, the sender will see "No accepted responders yet" even after receiver accepts
- The app includes polling fallbacks, but they will also fail if RLS policies are blocking
- Run both migrations in order (1 first, then 2)

