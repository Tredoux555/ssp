# Storage Cleanup Scripts

## Clear Supabase Storage (Current Setup)

This project uses **Supabase Storage** for emergency photos. To clear all files:

### Option 1: Using the Script (Recommended)

1. Make sure you have `tsx` installed:
   ```bash
   npm install -g tsx
   # OR
   npm install --save-dev tsx
   ```

2. Set your environment variables in `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

3. Run the script:
   ```bash
   npx tsx scripts/clear-supabase-storage.ts
   ```

### Option 2: Manual via Supabase Dashboard

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **Storage** → **Buckets**
4. Click on `emergency-photos` bucket
5. Select all files (or use folder selection)
6. Click **Delete** button
7. Confirm deletion

### Option 3: Using Supabase SQL Editor

```sql
-- This will delete all files from the emergency-photos bucket
-- Note: This requires admin access

-- List all files first (optional, to see what will be deleted)
SELECT name, bucket_id, created_at, metadata
FROM storage.objects
WHERE bucket_id = 'emergency-photos';

-- Delete all files (WARNING: This is irreversible!)
DELETE FROM storage.objects
WHERE bucket_id = 'emergency-photos';
```

---

## Clear Vercel Blob Storage

If you're using Vercel Blob Storage (not currently set up in this project):

### Option 1: Using the Script

1. Install Vercel Blob SDK:
   ```bash
   npm install @vercel/blob
   ```

2. Get your `BLOB_READ_WRITE_TOKEN` from:
   - Vercel Dashboard → Your Project → Settings → Environment Variables
   - Or: Vercel Dashboard → Storage → Blob → Settings

3. Set the token:
   ```bash
   export BLOB_READ_WRITE_TOKEN=your_token_here
   ```

4. Run the script:
   ```bash
   npx tsx scripts/clear-vercel-blob.ts
   ```

### Option 2: Using Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# List all blobs
vercel blob list

# Delete a specific blob
vercel blob del <url-or-pathname>

# Note: CLI doesn't support bulk delete, so you'd need to delete individually
```

### Option 3: Using Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Storage** → **Blob**
4. Select files and delete them manually

---

## Which Storage Are You Using?

**Current Setup**: This project uses **Supabase Storage** (bucket: `emergency-photos`)

To verify:
- Check `lib/services/photo.ts` - it uses `supabase.storage.from('emergency-photos')`
- Check your `.env.local` - you should have `NEXT_PUBLIC_SUPABASE_URL`

If you want to switch to Vercel Blob, you'll need to:
1. Install `@vercel/blob` package
2. Update `lib/services/photo.ts` to use Vercel Blob API
3. Set up `BLOB_READ_WRITE_TOKEN` environment variable


