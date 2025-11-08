-- ============================================================================
-- STORAGE POLICIES FOR EMERGENCY PHOTOS
-- ============================================================================
-- Run this AFTER creating the 'emergency-photos' bucket in Supabase Storage
-- Make sure the bucket is set to PUBLIC

-- Allow authenticated users to upload photos for their alerts
-- The folder structure is: {alert_id}/{photo_id}.jpg
-- We check that the alert_id folder matches the user's alert
CREATE POLICY "Alert creators can upload photos"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'emergency-photos' AND
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id::text = (storage.foldername(name))[1]
      AND ea.user_id = auth.uid()
    )
  );

-- Allow alert creators to view their photos
CREATE POLICY "Alert creators can view their photos"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'emergency-photos' AND
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id::text = (storage.foldername(name))[1]
      AND ea.user_id = auth.uid()
    )
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

