-- ============================================================================
-- COMPREHENSIVE RLS POLICY FIX FOR CLIENT-SIDE OPERATIONS
-- Run this ONCE in Supabase SQL Editor to fix ALL issues
-- ============================================================================

-- ============================================================================
-- 1. FIX emergency_alerts UPDATE POLICY (Allow cancel/resolve)
-- ============================================================================
DROP POLICY IF EXISTS "Users can update own alerts" ON emergency_alerts;

CREATE POLICY "Users can update own alerts" ON emergency_alerts
  FOR UPDATE 
  USING (auth.uid() = user_id AND status = 'active')
  WITH CHECK (
    auth.uid() = user_id 
    AND (status = 'cancelled' OR status = 'resolved' OR status = 'active')
  );

-- ============================================================================
-- 2. FIX contact_invites POLICIES (Allow invitees to view/accept invites)
-- ============================================================================
-- Create helper function to check if invite is for current user
CREATE OR REPLACE FUNCTION is_invite_for_current_user(invite_target_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = auth.uid() 
    AND lower(email) = lower(invite_target_email)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow invitees to view invites sent to them
CREATE POLICY "Invitees can view invites sent to them" ON contact_invites
  FOR SELECT USING (
    is_invite_for_current_user(target_email)
  );

-- Allow invitees to update invites sent to them (to mark as accepted)
CREATE POLICY "Invitees can update invites sent to them" ON contact_invites
  FOR UPDATE 
  USING (is_invite_for_current_user(target_email))
  WITH CHECK (is_invite_for_current_user(target_email));

-- Fix inviter update policy (add WITH CHECK)
DROP POLICY IF EXISTS "Inviter can update own invites" ON contact_invites;

CREATE POLICY "Inviter can update own invites" ON contact_invites
  FOR UPDATE 
  USING (auth.uid() = inviter_user_id)
  WITH CHECK (auth.uid() = inviter_user_id);

-- ============================================================================
-- 3. FIX emergency_contacts UPDATE POLICY (Add WITH CHECK)
-- ============================================================================
DROP POLICY IF EXISTS "Users can update own contacts" ON emergency_contacts;

CREATE POLICY "Users can update own contacts" ON emergency_contacts
  FOR UPDATE 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 4. FIX push_subscriptions UPDATE POLICY (Add WITH CHECK)
-- ============================================================================
-- Only update policy if table exists (push_subscriptions is optional)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'push_subscriptions'
  ) THEN
    DROP POLICY IF EXISTS "Users can update own push subscriptions" ON push_subscriptions;

    CREATE POLICY "Users can update own push subscriptions" ON push_subscriptions
      FOR UPDATE 
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================================
-- 5. FIX user_profiles UPDATE POLICY (Add WITH CHECK)
-- ============================================================================
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 6. CREATE DATABASE FUNCTION FOR BIDIRECTIONAL CONTACTS
-- ============================================================================
-- This function creates bidirectional contacts when an invite is accepted
-- It runs with SECURITY DEFINER so it can create contacts for both users
-- The accepter is the user who is updating the invite (auth.uid())
CREATE OR REPLACE FUNCTION create_bidirectional_contact_on_invite_accept()
RETURNS TRIGGER AS $$
DECLARE
  inviter_id UUID;
  accepter_id UUID;
  inviter_email TEXT;
  accepter_email TEXT;
BEGIN
  -- Only run when accepted_at is set (invite is being accepted)
  IF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
    inviter_id := NEW.inviter_user_id;
    accepter_id := auth.uid(); -- The user updating the invite is the accepter
    
    -- Get emails from auth.users
    SELECT email INTO inviter_email FROM auth.users WHERE id = inviter_id;
    SELECT email INTO accepter_email FROM auth.users WHERE id = accepter_id;
    
    -- Verify accepter email matches invite target
    IF accepter_email IS NULL OR lower(accepter_email) != lower(NEW.target_email) THEN
      RAISE EXCEPTION 'Invite email does not match accepter email';
    END IF;
    
    -- Create contact in inviter's list (pointing to accepter)
    INSERT INTO emergency_contacts (
      user_id, 
      contact_user_id, 
      email, 
      name, 
      can_see_location, 
      verified
    )
    VALUES (
      inviter_id,
      accepter_id,
      accepter_email,
      split_part(accepter_email, '@', 1),
      true,
      true
    )
    ON CONFLICT (user_id, contact_user_id) 
    DO UPDATE SET 
      verified = true,
      email = accepter_email;
    
    -- Create contact in accepter's list (pointing to inviter)
    INSERT INTO emergency_contacts (
      user_id, 
      contact_user_id, 
      email, 
      name, 
      can_see_location, 
      verified
    )
    VALUES (
      accepter_id,
      inviter_id,
      inviter_email,
      split_part(inviter_email, '@', 1),
      true,
      true
    )
    ON CONFLICT (user_id, contact_user_id) 
    DO UPDATE SET 
      verified = true,
      email = inviter_email;
    
    RAISE NOTICE 'Bidirectional contacts created for inviter % and accepter %', inviter_id, accepter_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-create bidirectional contacts when invite is accepted
DROP TRIGGER IF EXISTS trigger_create_bidirectional_contact ON contact_invites;

CREATE TRIGGER trigger_create_bidirectional_contact
  AFTER UPDATE ON contact_invites
  FOR EACH ROW
  WHEN (NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL)
  EXECUTE FUNCTION create_bidirectional_contact_on_invite_accept();

