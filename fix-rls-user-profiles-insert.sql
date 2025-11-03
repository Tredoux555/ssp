-- Fix: Add missing INSERT policy for user_profiles table
-- This fixes the registration hanging issue
-- Run this in your Supabase SQL Editor

-- Drop existing policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;

-- Create INSERT policy for user_profiles
CREATE POLICY "Users can insert own profile" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Verify the policy was created
SELECT * FROM pg_policies 
WHERE tablename = 'user_profiles' 
AND policyname = 'Users can insert own profile';

