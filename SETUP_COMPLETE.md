# Setup Complete - Emergency Alert System

## ✅ Configuration Status

All required components are now configured:

### Environment Variables
- ✅ Supabase URL and keys configured
- ✅ VAPID keys configured for push notifications

### Database Migrations
- ✅ Run `migrations/fix-emergency-alerts-comprehensive.sql` in Supabase SQL Editor
  - This enables Realtime for emergency_alerts
  - Fixes RLS policies for contact access
  - Creates diagnostic function

### Dependencies
- ✅ All required packages installed
- ✅ web-push package installed

## 🧪 Testing the System

### 1. Test Connection Diagnostics

1. Navigate to: http://localhost:3000/diagnostics
2. The page will automatically run all connection tests
3. Check results:
   - **Green checkmarks** = Working correctly
   - **Yellow warnings** = Partial issues
   - **Red X** = Needs fixing

### 2. Test Alert Flow

1. **User A (Alert Creator):**
   - Log in to the app
   - Navigate to dashboard
   - Click "Emergency Alert" button
   - Check browser console for:
     - `[Alert] ✅ Alert created with X contact(s) in contacts_notified array`
     - `[Push] ✅ Push notification sent to user`

2. **User B (Contact):**
   - Log in to the app (different account)
   - Should automatically receive:
     - Real-time alert (if subscription working)
     - Polling fallback (checks every 2 seconds)
     - Push notification (if app is closed)
   - Check browser console for:
     - `[Realtime] ✅ Successfully subscribed`
     - `[Dashboard] ✅ Found alert for user`
     - `[Realtime] 📨 Contact alert event received`

### 3. Verify Database Setup

Run these queries in Supabase SQL Editor to verify:

```sql
-- Check Realtime is enabled
SELECT tablename FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
AND tablename = 'emergency_alerts';

-- Check RLS policies exist
SELECT policyname FROM pg_policies 
WHERE tablename = 'emergency_alerts'
AND (policyname LIKE '%notified%' OR policyname LIKE '%response%');

-- Check active alerts
SELECT id, user_id, status, contacts_notified 
FROM emergency_alerts 
WHERE status = 'active';
```

## 📋 What Should Work Now

### ✅ Emergency Alerts
- Creating alerts with contacts_notified populated
- Contacts receiving alerts via real-time subscriptions
- Polling fallback if real-time fails
- RLS policies allowing contact access

### ✅ Push Notifications
- Push notifications sent when alerts are created
- Works when app is closed
- Loud, persistent notifications
- Sound and vibration

### ✅ Connection Diagnostics
- Full diagnostic suite available at `/diagnostics`
- Tests all connection paths
- Shows detailed error messages

## 🔍 Troubleshooting

### Alerts Not Showing on Linked Accounts

1. **Check Diagnostics:**
   - Go to `/diagnostics`
   - Look for red X marks
   - Fix any errors shown

2. **Check Browser Console:**
   - Look for `[Realtime]` logs
   - Look for `[Dashboard]` logs
   - Look for `[Alert]` logs

3. **Check Database:**
   - Verify contacts are verified and have `contact_user_id`
   - Verify alerts have `contacts_notified` populated
   - Verify RLS policies exist

4. **Check Realtime:**
   - Verify `emergency_alerts` is in Realtime publication
   - Check Supabase Dashboard > Database > Replication

### Push Notifications Not Working

1. **Check VAPID Keys:**
   - Verify keys are in `.env.local`
   - Restart dev server after adding keys

2. **Check Browser Permissions:**
   - User must grant notification permission
   - Check browser settings

3. **Check Push Subscriptions:**
   - Verify `push_subscriptions` table exists
   - Check if user has subscription in database

## 📝 Next Steps

1. ✅ All configuration complete
2. ✅ Diagnostics available at `/diagnostics`
3. ⏭️ Test alert creation and reception
4. ⏭️ Monitor console logs for issues
5. ⏭️ Verify push notifications work

## 🎯 Success Indicators

You'll know it's working when:
- User B receives alert immediately after User A creates it
- Console shows `[Realtime] ✅ Successfully subscribed`
- Console shows `[Dashboard] ✅ Found alert for user`
- Push notification appears (if app is closed)
- Alert page opens automatically

## 📚 Documentation

- `DIAGNOSTICS_GUIDE.md` - How to use diagnostics
- `DEBUGGING_GUIDE.md` - Step-by-step debugging
- `COMPLETE_FIX_SUMMARY.md` - What was fixed
- `PUSH_NOTIFICATIONS_COMPLETE.md` - Push notification setup

## 🚀 Ready to Test!

Everything is configured. Navigate to `/diagnostics` to verify connections, then test creating an emergency alert between two linked accounts.

