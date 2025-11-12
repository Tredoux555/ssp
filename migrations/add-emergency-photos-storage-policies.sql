-- ============================================================================
-- EMERGENCY PHOTOS TABLE - For photo capture and sharing during emergencies
-- ============================================================================

-- Create emergency_photos table
CREATE TABLE IF NOT EXISTS emergency_photos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  alert_id UUID REFERENCES emergency_alerts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_emergency_photos_alert_id ON emergency_photos(alert_id);
CREATE INDEX IF NOT EXISTS idx_emergency_photos_user_id ON emergency_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_photos_created_at ON emergency_photos(created_at DESC);

-- Enable Row Level Security
ALTER TABLE emergency_photos ENABLE ROW LEVEL SECURITY;

-- Policy: Alert creators can insert photos for their alerts
CREATE POLICY "Alert creators can insert photos for their alerts"
  ON emergency_photos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id = emergency_photos.alert_id
      AND ea.user_id = auth.uid()
    )
  );

-- Policy: Alert creators can view photos for their alerts
CREATE POLICY "Alert creators can view photos for their alerts"
  ON emergency_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id = emergency_photos.alert_id
      AND ea.user_id = auth.uid()
    )
  );

-- Policy: Receivers can view photos for alerts they're notified about
CREATE POLICY "Receivers can view photos for their alerts"
  ON emergency_photos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM emergency_alerts ea
      WHERE ea.id = emergency_photos.alert_id
      AND auth.uid()::text = ANY(ea.contacts_notified)
    )
  );

-- Enable Realtime for emergency_photos
ALTER PUBLICATION supabase_realtime ADD TABLE emergency_photos;

