-- PSP (Personal Security Program) Database Schema
-- Completely separate from jeffy projects
-- This file contains the SQL commands to set up the Supabase database

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create user_profiles table (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  full_name VARCHAR(255),
  profile_photo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create emergency_alerts table
CREATE TABLE emergency_alerts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'cancelled')),
  alert_type VARCHAR(50) DEFAULT 'other' CHECK (alert_type IN ('robbery', 'house_breaking', 'car_jacking', 'accident', 'other')),
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  address TEXT,
  triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  contacts_notified TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create emergency_contacts table
CREATE TABLE emergency_contacts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  contact_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  relationship VARCHAR(100),
  priority INTEGER DEFAULT 0,
  can_see_location BOOLEAN DEFAULT true,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, contact_user_id)
);

-- Create alert_responses table
CREATE TABLE alert_responses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  alert_id UUID REFERENCES emergency_alerts(id) ON DELETE CASCADE NOT NULL,
  contact_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  navigated_to_location BOOLEAN DEFAULT false,
  arrived_at_location TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(alert_id, contact_user_id)
);

-- Create location_history table
CREATE TABLE location_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  alert_id UUID REFERENCES emergency_alerts(id) ON DELETE CASCADE,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy DECIMAL(10, 2),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create social_groups table (admin-managed)
CREATE TABLE social_groups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  member_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create group_members table
CREATE TABLE group_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  group_id UUID REFERENCES social_groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- Create admin_notifications table
CREATE TABLE admin_notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sent_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  target_type VARCHAR(50) NOT NULL CHECK (target_type IN ('all_users', 'specific_group')),
  target_group_id UUID REFERENCES social_groups(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivery_status VARCHAR(50) DEFAULT 'pending'
);

-- Create audit_logs table
CREATE TABLE audit_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type VARCHAR(100) NOT NULL,
  details JSONB,
  ip_address INET,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_emergency_alerts_user_id ON emergency_alerts(user_id);
CREATE INDEX idx_emergency_alerts_status ON emergency_alerts(status);
CREATE INDEX idx_emergency_alerts_triggered_at ON emergency_alerts(triggered_at DESC);
CREATE INDEX idx_emergency_contacts_user_id ON emergency_contacts(user_id);
CREATE INDEX idx_alert_responses_alert_id ON alert_responses(alert_id);
CREATE INDEX idx_alert_responses_contact_user_id ON alert_responses(contact_user_id);
CREATE INDEX idx_location_history_user_id ON location_history(user_id);
CREATE INDEX idx_location_history_alert_id ON location_history(alert_id);
CREATE INDEX idx_location_history_timestamp ON location_history(timestamp DESC);
CREATE INDEX idx_group_members_group_id ON group_members(group_id);
CREATE INDEX idx_group_members_user_id ON group_members(user_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);

-- Contact invites for email-based linking
CREATE TABLE IF NOT EXISTS contact_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inviter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_email TEXT NOT NULL,
  token UUID NOT NULL DEFAULT uuid_generate_v4(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(token)
);

-- Indexes for contact_invites
CREATE INDEX IF NOT EXISTS contact_invites_inviter_email_idx
  ON contact_invites (inviter_user_id, lower(target_email));

-- Optional de-duplication by email for contacts
CREATE UNIQUE INDEX IF NOT EXISTS emergency_contacts_user_email_unique
  ON emergency_contacts (user_id, lower(email))
  WHERE email IS NOT NULL;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_emergency_alerts_updated_at BEFORE UPDATE ON emergency_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_emergency_contacts_updated_at BEFORE UPDATE ON emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_social_groups_updated_at BEFORE UPDATE ON social_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to update group member count
CREATE OR REPLACE FUNCTION update_group_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE social_groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE social_groups SET member_count = member_count - 1 WHERE id = OLD.group_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_group_member_count_trigger
  AFTER INSERT OR DELETE ON group_members
  FOR EACH ROW EXECUTE FUNCTION update_group_member_count();

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_invites ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
-- Users can only see their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can insert their own profile (needed for signup)
CREATE POLICY "Users can insert own profile" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for emergency_alerts
-- Users can see their own alerts
CREATE POLICY "Users can view own alerts" ON emergency_alerts
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own alerts
CREATE POLICY "Users can create own alerts" ON emergency_alerts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own active alerts
CREATE POLICY "Users can update own alerts" ON emergency_alerts
  FOR UPDATE USING (auth.uid() = user_id AND status = 'active');

-- Contacts can see alerts they're notified about
CREATE POLICY "Contacts can view notified alerts" ON emergency_alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM emergency_contacts
      WHERE emergency_contacts.user_id = emergency_alerts.user_id
      AND emergency_contacts.contact_user_id = auth.uid()
      AND (emergency_alerts.contacts_notified IS NULL OR auth.uid()::text = ANY(emergency_alerts.contacts_notified))
    )
  );

-- RLS Policies for emergency_contacts
-- Users can view their own contacts
CREATE POLICY "Users can view own contacts" ON emergency_contacts
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own contacts
CREATE POLICY "Users can create own contacts" ON emergency_contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own contacts
CREATE POLICY "Users can update own contacts" ON emergency_contacts
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own contacts
CREATE POLICY "Users can delete own contacts" ON emergency_contacts
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for alert_responses
-- Contacts can view responses to alerts they're involved with
CREATE POLICY "Contacts can view own responses" ON alert_responses
  FOR SELECT USING (auth.uid() = contact_user_id);

-- Contacts can create their own responses
CREATE POLICY "Contacts can create own responses" ON alert_responses
  FOR INSERT WITH CHECK (auth.uid() = contact_user_id);

-- Contacts can update their own responses
CREATE POLICY "Contacts can update own responses" ON alert_responses
  FOR UPDATE USING (auth.uid() = contact_user_id);

-- RLS Policies for location_history
-- Users can only see their own location history
CREATE POLICY "Users can view own location history" ON location_history
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own location
CREATE POLICY "Users can create own location" ON location_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Contacts can see location during active emergency
CREATE POLICY "Contacts can view location during emergency" ON location_history
  FOR SELECT USING (
    alert_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM emergency_alerts
      WHERE emergency_alerts.id = location_history.alert_id
      AND emergency_alerts.status = 'active'
      AND EXISTS (
        SELECT 1 FROM emergency_contacts
        WHERE emergency_contacts.user_id = location_history.user_id
        AND emergency_contacts.contact_user_id = auth.uid()
        AND emergency_contacts.can_see_location = true
      )
    )
  );

-- RLS Policies for contact_invites
-- Inviter can view/manage their own invites
CREATE POLICY "Inviter can select own invites" ON contact_invites
  FOR SELECT USING (auth.uid() = inviter_user_id);

CREATE POLICY "Inviter can insert own invites" ON contact_invites
  FOR INSERT WITH CHECK (auth.uid() = inviter_user_id);

CREATE POLICY "Inviter can update own invites" ON contact_invites
  FOR UPDATE USING (auth.uid() = inviter_user_id);

-- RLS Policies for social_groups
-- Anyone can view groups (public information)
CREATE POLICY "Anyone can view groups" ON social_groups
  FOR SELECT USING (true);

-- Only admin can create/update/delete groups (will be enforced by admin middleware)
-- Regular users cannot create groups

-- RLS Policies for group_members
-- Users can view members of groups they're in
CREATE POLICY "Users can view group members" ON group_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
    )
  );

-- Admin can manage group members (will be enforced by admin middleware)

-- RLS Policies for admin_notifications
-- Users can view notifications sent to them
CREATE POLICY "Users can view relevant notifications" ON admin_notifications
  FOR SELECT USING (
    target_type = 'all_users'
    OR (
      target_type = 'specific_group'
      AND EXISTS (
        SELECT 1 FROM group_members
        WHERE group_members.group_id = admin_notifications.target_group_id
        AND group_members.user_id = auth.uid()
      )
    )
  );

-- Admin can create notifications (will be enforced by admin middleware)

-- RLS Policies for audit_logs
-- Only admin can view audit logs (will be enforced by admin middleware)
-- Logs are write-only for system

-- Note: Admin policies will be implemented in application logic
-- since RLS cannot check environment variables for admin email

