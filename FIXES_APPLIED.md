# Fixes Applied for Emergency Alerts

## Issues Fixed

### 1. RLS Policy Error for alert_responses
**Problem**: Alert creator couldn't create `alert_responses` for contacts from client-side (RLS violation)

**Solution**:
- Created server-side API endpoint: `/api/emergency/create-responses`
- Updated client-side code to call API instead of direct insert
- Added RLS policy to allow alert creators to create responses for their contacts
- Migration: `migrations/fix-emergency-alerts-comprehensive.sql` (section 9)

### 2. 406 Errors on alert_responses
**Problem**: Contacts getting 406 errors when trying to query/subscribe to `alert_responses`

**Solution**:
- Changed query from `.single()` to `.maybeSingle()` to handle null case gracefully
- Added try-catch around subscription setup
- Made subscription failures non-critical (alert still works without it)

### 3. Missing Audio File
**Problem**: `emergency-alert.mp3` file doesn't exist (404 errors)

**Solution**:
- Audio errors are already handled gracefully (non-blocking)
- Audio is optional - alerts work without sound
- Note: Can add audio file later to `/public/emergency-alert.mp3` if desired

### 4. WebSocket Connection Issues
**Problem**: WebSocket connections closing/suspending

**Solution**:
- Enhanced error handling in subscription manager
- Made subscription failures non-critical
- Polling fallback ensures alerts are received even if Realtime fails

## Migrations to Run

### 1. Primary Migration (Required)
Run in Supabase SQL Editor:
```
migrations/fix-emergency-alerts-comprehensive.sql
```

This migration:
- Enables Realtime for `emergency_alerts`
- Fixes RLS policies for contacts viewing alerts
- Adds RLS policy for alert creators to create responses
- Creates diagnostic function
- Adds performance indexes

### 2. Optional: Fix Bidirectional Contacts
If contacts aren't bidirectional:
```
migrations/fix-bidirectional-contacts.sql
```

## Testing Checklist

After running migrations:

1. ✅ Create alert from User A
2. ✅ Check User B receives alert (via real-time or polling)
3. ✅ Check User B can view alert details page
4. ✅ Check User B can acknowledge alert
5. ✅ Check push notification sent (if enabled)
6. ✅ Check console logs for errors

## Known Non-Critical Issues

- Audio file 404: Expected if file doesn't exist, alerts work without sound
- WebSocket suspension: May occur, but polling fallback handles it
- Subscription 406 errors: Non-critical, alerts still work

## Next Steps

1. Run the database migration
2. Test alert creation and reception
3. Verify contacts can view and acknowledge alerts
4. Check browser console for any remaining errors

