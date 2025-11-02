# Email Verification Configuration

## Current Status: Email Verification DISABLED

Email verification is currently **disabled** in the SSP application. Users can sign up and immediately access the dashboard without needing to verify their email address.

## Code Status

- All email verification code is **kept in the codebase** for future use
- Verification page exists at `/auth/verify`
- Verification logic is ready but not required

## Supabase Configuration

To disable email verification (already done if you follow these steps):

1. **In Supabase Dashboard:**
   - Go to **Authentication** → **Providers** → **Email**
   - Under "Email Auth" settings
   - Find **"Enable email confirmations"** toggle
   - **Turn it OFF** (disable)
   - Click **Save**

2. **Result:**
   - Users can sign up and immediately log in
   - No verification email is sent
   - User account is active immediately after signup

## Re-enabling Email Verification (Future)

If you want to enable email verification later:

1. **In Supabase Dashboard:**
   - Go to **Authentication** → **Providers** → **Email**
   - Turn **"Enable email confirmations"** ON
   - Go to **Authentication** → **URL Configuration**
   - Add redirect URLs (see `SUPABASE_REDIRECT_SETUP.md`)

2. **In Code:**
   - The verification code is already in place
   - Update `AuthContext.tsx` signUp function to check `email_confirmed_at`
   - Update register page to show verification message

3. **Files to modify:**
   - `lib/contexts/AuthContext.tsx` - Uncomment verification check
   - `app/auth/register/page.tsx` - Add verification message

## Benefits of Current Setup (No Verification)

- **Faster user onboarding** - Immediate access to emergency features
- **Lower barrier to entry** - No email check required
- **Better for emergency situations** - Users can use app immediately
- **Simpler user experience** - One less step in signup process

## Security Considerations

- Email verification helps prevent fake accounts
- Without verification, anyone can sign up with any email
- For a free emergency app, this trade-off may be acceptable
- You can always enable it later if needed

