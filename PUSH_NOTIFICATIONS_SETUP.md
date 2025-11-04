# Push Notifications Setup Guide

## Overview

This app now supports loud, persistent push notifications for emergency alerts. When an emergency alert is created, all verified emergency contacts receive a push notification that:

- Works even when the app is closed
- Plays loud alarm sound
- Vibrates the device
- Shows a bright, flashing red notification
- Can't be easily dismissed
- Requires user interaction

## Setup Steps

### 1. Install Dependencies

```bash
npm install web-push
```

### 2. Generate VAPID Keys

VAPID (Voluntary Application Server Identification) keys are required for web push notifications. Generate them using:

```bash
npx web-push generate-vapid-keys
```

This will output:
- Public Key: Add to `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- Private Key: Add to `.env.local` as `VAPID_PRIVATE_KEY`
- Email: Add to `.env.local` as `VAPID_EMAIL` (e.g., `mailto:admin@yourapp.com`)

### 3. Update Environment Variables

Add to your `.env.local` file:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_EMAIL=mailto:admin@yourapp.com
```

### 4. Run Database Migration

Run the migration file in your Supabase SQL editor:

```sql
-- Run migrations/add-push-subscriptions.sql
```

This creates the `push_subscriptions` table and RLS policies.

### 5. Deploy

Push notifications will work automatically once:
- Service Worker is registered (happens automatically on app load)
- User grants notification permission
- VAPID keys are configured
- Database migration is run

## How It Works

1. **Service Worker Registration**: On app load, the Service Worker (`public/sw.js`) is registered automatically
2. **Permission Request**: When user logs in, notification permission is requested
3. **Device Registration**: If permission is granted, device is registered for push notifications
4. **Emergency Alert**: When an emergency alert is created:
   - Contacts are notified via Realtime (existing)
   - Push notifications are sent to all contacts with push enabled (new)
   - Notification shows loud, persistent alert with sound and vibration

## Testing

1. **Enable Notifications**: Log in to the app and grant notification permission
2. **Create Emergency Alert**: Trigger an emergency alert from the dashboard
3. **Check Notification**: Contact should receive:
   - Push notification (if app is closed)
   - Full-screen alert (if app is open)
   - Loud sound
   - Vibration

## Troubleshooting

### Notifications Not Working

1. **Check Browser Support**: Ensure browser supports Service Workers and Push API
2. **Check Permissions**: Verify notification permission is granted in browser settings
3. **Check VAPID Keys**: Ensure keys are set in environment variables
4. **Check Console**: Look for errors in browser console
5. **Check Service Worker**: Verify Service Worker is registered (check DevTools > Application > Service Workers)

### web-push Not Found

If you see "web-push not installed":
- Run: `npm install web-push`
- Restart the development server

### VAPID Keys Not Configured

If you see "VAPID keys not configured":
- Generate keys: `npx web-push generate-vapid-keys`
- Add to `.env.local`
- Restart the development server

### Database Table Not Found

If you see "table push_subscriptions does not exist":
- Run the migration file: `migrations/add-push-subscriptions.sql`
- In Supabase SQL editor, paste and run the migration

## Features

### Loud Sound
- Custom emergency alarm sound
- Maximum volume
- Looping sound
- Works even when phone is silent (if supported)

### Bright Flashing
- Red flashing screen overlay
- High brightness
- Pulsing animation
- Can't be ignored

### Persistent
- Critical priority
- Can't be auto-dismissed
- Requires user interaction
- Stays until acknowledged

### Vibration
- Strong vibration pattern
- Repeating pattern
- Can't be silenced (on supported devices)

### Works When Closed
- Service Worker handles notifications
- Push API for background delivery
- Works even when app not open

## Next Steps

For production:
1. Set up proper VAPID keys in production environment
2. Test push notifications on multiple devices
3. Consider adding notification preferences in user settings
4. Monitor push notification delivery rates
5. Handle expired subscriptions gracefully (already implemented)

