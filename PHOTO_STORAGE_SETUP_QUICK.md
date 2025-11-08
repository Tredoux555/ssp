# Photo Storage Setup - Quick Guide

## Step 1: Create Storage Bucket

You have two options:

### Option A: Use the API Endpoint (After Deployment)
Once the code is deployed, visit or call:
```
POST https://your-domain.com/api/storage/setup-bucket
```

Or use curl:
```bash
curl -X POST https://your-domain.com/api/storage/setup-bucket
```

### Option B: Manual Setup (Recommended)
1. Go to Supabase Dashboard → **Storage**
2. Click **"New bucket"**
3. Name: `emergency-photos`
4. **Public bucket**: ✅ Check this (photos need to be accessible to receivers)
5. Click **"Create bucket"**

## Step 2: Run Storage Policies SQL

1. Go to Supabase Dashboard → **SQL Editor**
2. Copy the contents of `migrations/add-emergency-photos-storage-policies.sql`
3. Paste into SQL Editor
4. Click **"Run"**
5. Wait for success message

## Step 3: Verify Setup

1. Check that `emergency-photos` bucket exists in Storage
2. Check that bucket is set to **Public**
3. Check that storage policies are created (in SQL Editor, run):
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE '%emergency%';
   ```

## Step 4: Test Photo Upload

1. Create an emergency alert
2. Click "Take Photo" button
3. Take/select a photo
4. Photo should upload and appear in the gallery

## Troubleshooting

### "Bucket not found" error
- Make sure the bucket name is exactly `emergency-photos` (with hyphen)
- Make sure the bucket is created and public

### "Permission denied" error
- Run the storage policies SQL migration
- Check that RLS is enabled on the `storage.objects` table

### "Database table missing" error
- Run `migrations/add-emergency-photos-table.sql` in SQL Editor

### Photo uploads but doesn't show
- Check browser console for errors
- Verify Realtime is enabled for `emergency_photos` table
- Check that photo subscription is working

