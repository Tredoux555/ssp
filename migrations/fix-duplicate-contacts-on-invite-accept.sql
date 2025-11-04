-- ============================================================================
-- FIX: Merge duplicate contacts when invite is accepted
-- When an invite is accepted, if a placeholder contact exists (verified=false, contact_user_id=NULL),
-- update it instead of creating a duplicate verified contact
-- ============================================================================

CREATE OR REPLACE FUNCTION create_bidirectional_contact_on_invite_accept()
RETURNS TRIGGER AS $$
DECLARE
  inviter_id UUID;
  accepter_id UUID;
  inviter_email TEXT;
  accepter_email TEXT;
  existing_inviter_contact_id UUID;
  existing_accepter_contact_id UUID;
BEGIN
  -- Only run when accepted_at is set (invite is being accepted)
  IF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
    inviter_id := NEW.inviter_user_id;
    accepter_id := auth.uid(); -- The user updating the invite is the accepter
    
    -- Get emails from auth.users
    SELECT email INTO inviter_email FROM auth.users WHERE id = inviter_id;
    SELECT email INTO accepter_email FROM auth.users WHERE id = accepter_id;
    
    -- Verify accepter email matches invite target (normalize both for comparison)
    IF accepter_email IS NULL OR 
       trim(lower(accepter_email)) != trim(lower(NEW.target_email)) THEN
      RAISE EXCEPTION 'Invite email does not match accepter email. Invite: %, Accepter: %', 
        NEW.target_email, accepter_email;
    END IF;
    
    -- ============================================================================
    -- Handle inviter's contact (pointing to accepter)
    -- ============================================================================
    -- First, check if a placeholder contact exists (same email, no contact_user_id)
    SELECT id INTO existing_inviter_contact_id
    FROM emergency_contacts
    WHERE user_id = inviter_id
      AND lower(email) = lower(accepter_email)
      AND contact_user_id IS NULL
    LIMIT 1;
    
    IF existing_inviter_contact_id IS NOT NULL THEN
      -- Update existing placeholder contact
      UPDATE emergency_contacts
      SET 
        contact_user_id = accepter_id,
        verified = true,
        email = accepter_email,
        name = split_part(accepter_email, '@', 1),
        can_see_location = true
      WHERE id = existing_inviter_contact_id;
    ELSE
      -- Insert new contact (or update if conflict on user_id + contact_user_id)
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
    END IF;
    
    -- ============================================================================
    -- Handle accepter's contact (pointing to inviter)
    -- ============================================================================
    -- First, check if a placeholder contact exists (same email, no contact_user_id)
    SELECT id INTO existing_accepter_contact_id
    FROM emergency_contacts
    WHERE user_id = accepter_id
      AND lower(email) = lower(inviter_email)
      AND contact_user_id IS NULL
    LIMIT 1;
    
    IF existing_accepter_contact_id IS NOT NULL THEN
      -- Update existing placeholder contact
      UPDATE emergency_contacts
      SET 
        contact_user_id = inviter_id,
        verified = true,
        email = inviter_email,
        name = split_part(inviter_email, '@', 1),
        can_see_location = true
      WHERE id = existing_accepter_contact_id;
    ELSE
      -- Insert new contact (or update if conflict on user_id + contact_user_id)
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
    END IF;
    
    RAISE NOTICE 'Bidirectional contacts created/updated for inviter % and accepter %', inviter_id, accepter_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

