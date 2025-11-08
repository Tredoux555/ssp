# Emergency Photo Capture & Sharing Feature

## Overview
Allow senders to capture photos during an emergency alert and automatically share them with receivers in real-time.

## Implementation Plan

### Phase 1: Database & Storage Setup
1. **Create `emergency_photos` table**
   - Store photo metadata (alert_id, user_id, storage_path, timestamp)
   - Add RLS policies for sender and receivers
   - Enable Realtime for instant sharing

2. **Set up Supabase Storage**
   - Create `emergency-photos` bucket
   - Configure storage policies (sender can upload, receivers can read)
   - Set up automatic cleanup for old photos

### Phase 2: Photo Upload Service
1. **Create photo upload utility**
   - Handle camera capture (mobile and desktop)
   - Compress images for faster upload
   - Upload to Supabase Storage
   - Save metadata to database

### Phase 3: Sender UI (Emergency Active Page)
1. **Add camera button**
   - Camera icon button in action area
   - Request camera permissions
   - Capture photo from camera or file picker
   - Show upload progress
   - Display captured photos in gallery

### Phase 4: Receiver UI (Alert Response Page)
1. **Add photo display section**
   - Subscribe to new photos via Realtime
   - Display photos in gallery/carousel
   - Show photo timestamp
   - Full-screen photo viewer

### Phase 5: Real-time Sharing
1. **Set up Realtime subscription**
   - Subscribe to `emergency_photos` table changes
   - Auto-update receiver UI when new photos arrive
   - Handle multiple photos per alert

### Phase 6: Testing & Edge Cases
1. **Test scenarios**
   - Single photo capture
   - Multiple photos
   - Photo upload failure handling
   - Network issues
   - Permission denial
   - Large file handling

## Technical Details

### Database Schema
```sql
CREATE TABLE emergency_photos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  alert_id UUID REFERENCES emergency_alerts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Storage Structure
- Bucket: `emergency-photos`
- Path: `{alert_id}/{photo_id}.jpg`
- Public URLs for easy access

### RLS Policies
- Sender can INSERT photos for their alerts
- Receivers can SELECT photos for alerts they're notified about
- Auto-cleanup after alert resolution

## Safety Considerations
- Photo size limits (max 5MB)
- Image compression to reduce bandwidth
- Error handling for upload failures
- Graceful degradation if camera unavailable
- Privacy: photos only visible during active alert

