-- ============================================================================
-- FIX BIDIRECTIONAL CONTACTS
-- Ensure all verified contacts have bidirectional relationships
-- ============================================================================

-- Create or replace function to ensure bidirectional contacts exist
CREATE OR REPLACE FUNCTION ensure_bidirectional_contact(
  user_a_id UUID,
  user_b_id UUID
)
RETURNS VOID AS $$
BEGIN
  -- Check if contact A->B exists
  IF NOT EXISTS (
    SELECT 1 FROM emergency_contacts
    WHERE user_id = user_a_id
    AND contact_user_id = user_b_id
    AND verified = true
  ) THEN
    RETURN; -- Contact doesn't exist, can't create bidirectional
  END IF;

  -- Check if reverse contact B->A exists
  IF NOT EXISTS (
    SELECT 1 FROM emergency_contacts
    WHERE user_id = user_b_id
    AND contact_user_id = user_a_id
    AND verified = true
  ) THEN
    -- Get email for user B
    DECLARE
      user_b_email TEXT;
      user_a_email TEXT;
    BEGIN
      SELECT email INTO user_b_email FROM auth.users WHERE id = user_b_id;
      SELECT email INTO user_a_email FROM auth.users WHERE id = user_a_id;
      
      -- Create reverse contact B->A
      INSERT INTO emergency_contacts (
        user_id,
        contact_user_id,
        email,
        name,
        verified,
        can_see_location
      )
      VALUES (
        user_b_id,
        user_a_id,
        user_a_email,
        COALESCE(split_part(user_a_email, '@', 1), 'Contact'),
        true,
        true
      )
      ON CONFLICT (user_id, contact_user_id) 
      DO UPDATE SET 
        verified = true,
        email = user_a_email;
    END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix existing contacts that are missing bidirectional relationship
-- This finds all verified contacts where the reverse relationship doesn't exist
DO $$
DECLARE
  contact_record RECORD;
BEGIN
  FOR contact_record IN
    SELECT ec1.user_id as user_a, ec1.contact_user_id as user_b
    FROM emergency_contacts ec1
    WHERE ec1.verified = true
    AND ec1.contact_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM emergency_contacts ec2
      WHERE ec2.user_id = ec1.contact_user_id
      AND ec2.contact_user_id = ec1.user_id
      AND ec2.verified = true
    )
  LOOP
    PERFORM ensure_bidirectional_contact(contact_record.user_a, contact_record.user_b);
  END LOOP;
END $$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION ensure_bidirectional_contact(UUID, UUID) TO authenticated;

