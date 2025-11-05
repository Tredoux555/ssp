# Emergency Alert Not Showing on Linked Accounts - Fix

## Problem
Emergency alerts weren't showing up on linked accounts despite verified contacts and proper `contacts_notified` array population.

## Root Cause
The RLS (Row Level Security) policy for contacts viewing emergency alerts was too restrictive. The policy required **both**:
1. A contact relationship exists in `emergency_contacts` where `user_id = alert.user_id` and `contact_user_id = current_user`
2. The current user must be in the `contacts_notified` array

This dual requirement caused issues because:
- Real-time subscriptions in Supabase respect RLS policies - if a user can't SELECT a row, they won't receive real-time events
- The contact relationship check was redundant since `contacts_notified` is only populated with verified `contact_user_id` values
- If the contact relationship check failed for any reason (timing, verification status, etc.), the user wouldn't receive the alert even if they were in `contacts_notified`

## Solution
Simplified the RLS policy to only check if the user is in `contacts_notified`. This is sufficient for security because:
- `contacts_notified` is only populated with verified contact user IDs from `emergency_contacts`
- The alert creator explicitly chose to notify these users
- This allows real-time subscriptions to work correctly

## Migration
Run the migration file: `migrations/fix-contact-alert-rls-policy.sql`

This will:
1. Drop the old restrictive policy
2. Create a new simplified policy that checks `auth.uid()::text = ANY(emergency_alerts.contacts_notified)`

## Testing
After applying the migration:
1. Create an emergency alert from User A
2. Verify User B (a linked contact) receives the alert via:
   - Real-time subscription (immediate)
   - Polling fallback (within 2 seconds)
3. Check browser console logs for:
   - `[Realtime] ✅ TRIGGERING CALLBACK for contact`
   - `[Dashboard] ✅ Found alert for user`
   - `[Dashboard] 🚨 POLLING FOUND ALERT FOR USER`

## Additional Notes
- The polling mechanism in `app/dashboard/page.tsx` will also benefit from this fix since it queries `emergency_alerts` and RLS filters the results
- Both real-time subscriptions and polling should now work correctly
- The fix maintains security since only verified contacts are added to `contacts_notified`

