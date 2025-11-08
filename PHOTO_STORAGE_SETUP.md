# Emergency Photos Storage Setup

## Step 1: Run Database Migration

Run the SQL migration file in Supabase SQL Editor:
```
migrations/add-emergency-photos-table.sql
```

This creates the `emergency_photos` table and RLS policies.

## Step 2: Create Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Click "New bucket"
3. Name: `emergency-photos`
4. **Public bucket**: ✅ Check this (photos need to be accessible to receivers)
5. Click "Create bucket"

## Step 3: Configure Storage Policies

Run this SQL in Supabase SQL Editor:

```sql
-- Allow authenticated users to upload photos for their alerts
CREATE POLICY "Alert creators can upload photos"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'emergency-photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow alert creators to view their photos
CREATE POLICY "Alert creators can view their photos"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'emergency-photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow receivers to view photos for alerts they're notified about
CREATE POLICY "Receivers can view photos for their alerts"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'emergency-photos' AND
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id::text = (storage.foldername(name))[1]
      AND auth.uid() = ANY(ea.contacts_notified)
    )
  );
```

## Step 4: Verify Setup

1. Check that `emergency_photos` table exists
2. Check that `emergency-photos` bucket exists and is public
3. Check that storage policies are created

## Storage Structure

Photos are stored with this structure:
```
emergency-photos/
  {alert_id}/
    {photo_id}.jpg
```

Example:
```
emergency-photos/
  2a30ea5c-499d-4fa1-b93b-a28ad0eeda54/
    abc123-def456-ghi789.jpg
```

## Notes

- Photos are automatically compressed to max 1920px width/height
- Maximum file size: 5MB (before compression)
- Photos are only accessible during active alerts
- Old photos are automatically cleaned up when alerts are deleted (via CASCADE)

