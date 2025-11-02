# Supabase Redirect URL Configuration

## Critical Step: Configure Redirect URLs in Supabase

After deploying to Vercel, you MUST configure redirect URLs in Supabase for email verification to work.

### Step-by-Step Instructions:

1. **Go to Supabase Dashboard**
   - Navigate to your SSP project
   - Go to **Authentication** → **URL Configuration**

2. **Set Site URL**
   - In the "Site URL" field, enter your Vercel production URL:
     ```
     https://your-project.vercel.app
     ```
   - Replace `your-project` with your actual Vercel project name

3. **Add Redirect URLs**
   - Scroll down to "Redirect URLs" section
   - Click "Add URL" or the "+" button
   - Add these URLs (one at a time):
   
   **For Production:**
   ```
   https://your-project.vercel.app/**
   https://your-project.vercel.app/auth/verify
   ```
   
   **For Development (if testing locally):**
   ```
   http://localhost:3000/**
   http://localhost:3000/auth/verify
   ```
   
   **If you have a custom domain:**
   ```
   https://yourdomain.com/**
   https://yourdomain.com/auth/verify
   ```

4. **Click "Save"**

### Important Notes:

- The `/**` wildcard allows all subpaths (recommended)
- You can add multiple redirect URLs
- Make sure to add both production and development URLs if needed
- After adding redirect URLs, existing verification emails won't update, but new ones will work correctly

### How It Works:

1. User signs up → Supabase sends verification email
2. Email contains link with code parameter: `https://your-app.vercel.app/auth/verify?code=xxx`
3. User clicks link → Redirected to `/auth/verify` page
4. Verification page extracts code from URL and verifies with Supabase
5. User is redirected to dashboard after successful verification

### Troubleshooting:

**If verification links still don't work:**
- Check that redirect URLs are correctly added in Supabase
- Make sure the URL matches exactly (including https/http and trailing slash)
- Wait a few minutes for changes to propagate
- Try signing up with a new email after configuring redirect URLs

