# Push Notifications - Complete Implementation

## ✅ What's Implemented

### Web Push Notifications (Working)
- ✅ Service Worker registration
- ✅ Push subscription management
- ✅ VAPID key configuration
- ✅ Emergency alert push notifications
- ✅ Works when app is closed
- ✅ Loud, persistent notifications
- ✅ Sound and vibration

### Push Notification Flow
1. User grants notification permission
2. Service Worker registers for push
3. Push subscription saved to database
4. When emergency alert is created:
   - Client-side: Calls `/api/push/send` for each contact
   - Server-side: Sends push notification via `web-push` library
   - Service Worker: Displays notification even when app is closed

## 📱 Native Push Notifications (Future)

### Current Status
- Native push tokens are stored in database (with `native:` prefix)
- Native push sending is **not yet implemented**
- Requires additional setup:
  - **Android**: Firebase Cloud Messaging (FCM)
  - **iOS**: Apple Push Notification Service (APNS)

### To Implement Native Push
1. Set up Firebase Cloud Messaging (Android)
2. Set up Apple Push Notification Service (iOS)
3. Create server endpoints to send via FCM/APNS
4. Update `lib/push-server.ts` to detect and send native push

## 🚀 Setup Instructions

### 1. Install Dependencies
```bash
npm install web-push
```

### 2. Generate VAPID Keys
```bash
npx web-push generate-vapid-keys
```

### 3. Add to `.env.local`
```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_EMAIL=mailto:admin@yourapp.com
```

### 4. Run Database Migration
Run `migrations/add-push-subscriptions.sql` in Supabase SQL Editor

## 🔔 How It Works

### When Alert is Created
1. Alert is created in database with `contacts_notified` array
2. For each contact:
   - Check if contact has push subscription
   - If yes, send push notification via `/api/push/send`
   - Server sends push using `web-push` library
   - Service Worker receives push and displays notification

### Notification Features
- **Loud**: Plays emergency sound
- **Persistent**: Requires user interaction to dismiss
- **Vibrating**: Strong vibration pattern
- **High Priority**: Maximum visibility
- **Actionable**: Clicking opens alert page

## 📝 Code Changes Made

### 1. Client-Side Alert Creation (`lib/services/emergency.ts`)
- Added push notification sending after alert creation
- Calls `/api/push/send` for each contact
- Non-blocking (fire and forget)

### 2. Server-Side Push (`lib/push-server.ts`)
- Handles web push notifications
- Detects native tokens (skips for now)
- Handles expired subscriptions

### 3. API Route (`app/api/push/send/route.ts`)
- Endpoint for sending push notifications
- Uses `web-push` library
- Handles errors gracefully

### 4. Service Worker (`public/sw.js`)
- Receives push notifications
- Displays notifications with sound/vibration
- Handles notification clicks

## 🧪 Testing

### Test Web Push
1. Enable notifications in browser
2. Create emergency alert from User A
3. Check User B's device (even if app is closed)
4. Should receive push notification

### Verify in Console
- `[Push] ✅ Push notification sent to user`
- `[Service Worker] Push notification received`
- `[Service Worker] Notification clicked`

## ⚠️ Important Notes

1. **Web Push Works**: Full implementation for web browsers
2. **Native Push**: Requires FCM/APNS setup (not yet implemented)
3. **VAPID Keys**: Must be configured for web push to work
4. **Service Worker**: Must be registered (happens automatically)
5. **Permissions**: User must grant notification permission

## 🐛 Troubleshooting

### Push Not Working?
1. Check VAPID keys are configured
2. Check user has granted notification permission
3. Check Service Worker is registered
4. Check browser console for errors
5. Verify push subscription exists in database

### "web-push not configured"
- Run: `npm install web-push`
- Restart dev server

### "VAPID keys not configured"
- Generate keys: `npx web-push generate-vapid-keys`
- Add to `.env.local`
- Restart dev server

### "User has not enabled push notifications"
- User needs to grant notification permission
- Check `push_subscriptions` table in database

## 📚 Next Steps

1. ✅ Web push notifications (DONE)
2. ⏳ Native push notifications (FCM/APNS)
3. ⏳ Notification preferences/settings
4. ⏳ Push notification analytics
5. ⏳ Notification delivery tracking

