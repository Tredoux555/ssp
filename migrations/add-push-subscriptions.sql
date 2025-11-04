-- Migration: Add push_subscriptions table for web push notifications
-- Run this migration in your Supabase SQL editor

-- Create push_subscriptions table for web push notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on push_subscriptions for faster lookups
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- RLS Policies for push_subscriptions
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own push subscriptions
CREATE POLICY "Users can view own push subscriptions" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own push subscriptions
CREATE POLICY "Users can insert own push subscriptions" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own push subscriptions
CREATE POLICY "Users can update own push subscriptions" ON push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own push subscriptions
CREATE POLICY "Users can delete own push subscriptions" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

