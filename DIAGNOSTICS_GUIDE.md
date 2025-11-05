# Connection Diagnostics Guide

## Overview

The Connection Diagnostics tool tests each step of the emergency alert notification connection path to identify where issues occur.

## Access

Navigate to `/diagnostics` or click "Connection Diagnostics" from the dashboard.

## What It Tests

### 1. Supabase Client Creation
- Verifies Supabase client can be created
- Checks environment variables are set
- Tests authentication status

### 2. Database Access
- Tests if user can query `emergency_alerts` table
- Verifies basic database connectivity
- Checks for RLS policy violations

### 3. RLS Policy Access
- Tests if user can see alerts where they're in `contacts_notified`
- Verifies the RLS policy is working correctly
- Checks if alerts are accessible via the policy

### 4. Real-time Subscription
- Tests connection to Supabase Realtime
- Verifies subscription can be established
- Checks subscription status (SUBSCRIBED, TIMED_OUT, CHANNEL_ERROR)

### 5. Push Notification Endpoint
- Tests if `/api/push/send` endpoint is accessible
- Verifies push notification API is working
- Checks if user has push notifications enabled

### 6. Contact Relationships
- Tests if user has verified contacts
- Checks if contacts have linked user IDs
- Verifies contact relationships are set up correctly

## Interpreting Results

### Green Checkmark (Success)
- Test passed successfully
- Connection is working correctly

### Yellow Warning
- Test partially passed
- May indicate configuration issues
- System may still work with fallbacks

### Red X (Error)
- Test failed
- Connection is broken at this step
- Fix required before alerts will work

## Common Issues

### Supabase Client Error
- Check environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Verify Supabase project is active
- Check network connectivity

### Database Access Error
- Check RLS policies are set up correctly
- Verify user is authenticated
- Check database connection

### RLS Policy Error
- Run migration: `migrations/fix-emergency-alerts-comprehensive.sql`
- Verify policy exists: `"Contacts can view notified alerts"`
- Check user is in `contacts_notified` array

### Real-time Subscription Error
- Check Supabase Realtime is enabled for `emergency_alerts` table
- Verify Realtime is enabled in Supabase Dashboard
- Check network connectivity
- Verify subscription isn't being blocked by firewall

### Push Notification Error
- Check VAPID keys are configured
- Verify `web-push` package is installed
- Check user has granted notification permission
- Verify push subscription exists in database

### Contact Relationships Warning
- Verify contacts are accepted/invited
- Check contacts are verified (`verified = true`)
- Ensure contacts have `contact_user_id` set (not just email/phone)

## Next Steps

After running diagnostics:

1. **Fix any errors** shown in red
2. **Address warnings** shown in yellow
3. **Verify all tests pass** (green checkmarks)
4. **Test alert creation** from another account
5. **Check console logs** for detailed error messages

## Files Created

- `lib/diagnostics/connection-test.ts` - Test utilities
- `components/ConnectionDiagnostics.tsx` - Diagnostic component
- `app/diagnostics/page.tsx` - Diagnostic page route

## Testing Flow

1. User A creates emergency alert
2. Diagnostic tool checks:
   - Can User A query alerts? (Database Access)
   - Can User A see alerts? (RLS Policy)
3. User B (contact) runs diagnostics:
   - Can User B query alerts? (Database Access)
   - Can User B see alerts where they're in contacts_notified? (RLS Policy)
   - Can User B connect to Realtime? (Real-time Subscription)
   - Can User B receive push notifications? (Push Notification Endpoint)

## Console Logs

Check browser console for detailed logs:
- `[Diagnostics]` - Diagnostic test logs
- `[Realtime]` - Real-time subscription logs
- `[Dashboard]` - Dashboard polling logs
- `[Alert]` - Alert creation logs

These logs provide detailed information about what's happening at each step.


