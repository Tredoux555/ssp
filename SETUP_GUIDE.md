# PSP Setup Guide

## Step-by-Step Setup Instructions

This guide will help you set up the PSP (Personal Security Program) from scratch.

---

## Step 1: Supabase Setup

1. **Create New Supabase Project**
   - Go to [supabase.com](https://supabase.com)
   - Sign in or create an account
   - Click "New Project"
   - Project name: `ssp` (or any name you prefer)
   - Database Password: Choose a strong password (save it!)
   - Region: Choose closest to South Africa
   - Click "Create new project"
   - Wait 2-3 minutes for setup to complete

2. **Run Database Schema**
   - In Supabase dashboard, go to "SQL Editor"
   - Copy the entire contents of `supabase-schema.sql`
   - Paste into SQL Editor
   - Click "Run"
   - Wait for "Success" message

3. **Enable Realtime**
   - In Supabase dashboard, go to "Database" > "Replication"
   - Find these tables and enable Realtime:
     - `emergency_alerts` ✓
     - `location_history` ✓
   - Click "Save" for each

4. **Get API Keys**
   - In Supabase dashboard, go to "Settings" > "API"
   - Copy "Project URL" (this is your `NEXT_PUBLIC_SUPABASE_URL`)
   - Copy "anon public" key (this is your `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - Copy "service_role" key (this is your `SUPABASE_SERVICE_ROLE_KEY`)

---

## Step 2: Google Maps API Setup

1. **Create Google Cloud Project**
   - Go to [console.cloud.google.com](https://console.cloud.google.com)
   - Create a new project or select existing
   - Enable these APIs:
     - Maps JavaScript API
     - Geocoding API
     - Directions API

2. **Create API Key**
   - Go to "Credentials" > "Create Credentials" > "API Key"
   - Copy the API key (this is your `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`)
   - (Optional) Restrict the key to only your domain for security

---

## Step 3: Environment Variables

1. **Create `.env.local` file**
   - In the `ssp` folder, create a file named `.env.local`
   - Copy this template:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
   
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
   
   ADMIN_EMAIL=your_admin_email@example.com
   ADMIN_PASSWORD=your_secure_admin_password_here
   ```

2. **Fill in the values**
   - Replace all `your_*_here` with your actual values from Steps 1 and 2

---

## Step 4: Test Locally

1. **Install dependencies** (if not done)
   ```bash
   npm install
   ```

2. **Start development server**
   ```bash
   npm run dev
   ```

3. **Open in browser**
   - Go to [http://localhost:3000](http://localhost:3000)
   - You should see the login page

4. **Create your first account**
   - Click "Sign up"
   - Enter your email, password, name, and phone
   - Click "Create Account"
   - You'll be redirected to the dashboard

5. **Test the emergency button**
   - On dashboard, click the red "EMERGENCY" button
   - Confirm the alert
   - You should see the emergency alert screen

---

## Step 5: GitHub Setup

1. **Initialize Git** (if not done)
   ```bash
   git init
   git add .
   git commit -m "Initial commit: PSP Emergency Alert System"
   ```

2. **Create GitHub Repository**
   - Go to [github.com](https://github.com)
   - Create a new repository named `ssp`
   - Don't initialize with README (we already have one)

3. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/yourusername/ssp.git
   git branch -M main
   git push -u origin main
   ```

---

## Step 6: Vercel Deployment

1. **Create Vercel Account**
   - Go to [vercel.com](https://vercel.com)
   - Sign in with GitHub

2. **Import Project**
   - Click "Add New..." > "Project"
   - Import your `ssp` repository from GitHub
   - Framework Preset: Next.js (should auto-detect)
   - Root Directory: `./` (default)

3. **Environment Variables**
   - In Vercel project settings, go to "Environment Variables"
   - Add all variables from your `.env.local` file:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
     - `ADMIN_EMAIL`
     - `ADMIN_PASSWORD`
   - Click "Save"

4. **Deploy**
   - Click "Deploy"
   - Wait 2-3 minutes for deployment
   - Your app will be live at `https://your-project.vercel.app`

---

## Step 7: Test Production

1. **Open your deployed app**
   - Go to your Vercel URL
   - Test the full flow:
     - Create account
     - Add emergency contacts
     - Test emergency button
     - Test location tracking

2. **Add Emergency Contacts**
   - Go to "Manage Contacts"
   - Add at least one contact (phone or email)
   - This contact will be notified when you press emergency button

---

## Important Notes

### Security
- **Never commit `.env.local`** - It's already in `.gitignore`
- **Keep API keys secret** - Don't share them
- **Use separate Supabase project** - Don't share with jeffy projects

### Rate Limiting
- Emergency button: Max 1 alert per 30 seconds
- Location updates: Max 1 update per 5 seconds

### Location Permissions
- Users must allow location access in browser
- Mobile browsers may require HTTPS for location access

### Push Notifications
- Currently implemented as database notifications
- Full push notification system (Supabase Edge Functions) can be added later

---

## Troubleshooting

### Build Errors
- Make sure all environment variables are set
- Run `npm install` to ensure dependencies are installed
- Check TypeScript errors: `npm run build`

### Location Not Working
- Make sure browser has location permission
- HTTPS required for production (Vercel provides this)
- Check Google Maps API key is correct

### Database Errors
- Verify database schema was run successfully
- Check RLS policies are enabled
- Make sure Realtime is enabled for required tables

### Authentication Issues
- Check Supabase URL and keys are correct
- Verify user_profiles table exists
- Check RLS policies allow user access

---

## Next Steps

After setup is complete:
1. Add emergency contacts
2. Test the emergency alert flow
3. Test location tracking
4. Configure admin access (future feature)
5. Set up push notifications (future feature)

---

## Support

If you encounter issues:
1. Check the error messages in the browser console
2. Check Supabase logs in dashboard
3. Check Vercel deployment logs
4. Review this guide for missed steps

Good luck! Stay safe! 🇿🇦

