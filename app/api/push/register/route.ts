import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let supabase
    try {
      supabase = await createServerClient()
    } catch (error) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Get authenticated user
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse request body
    let body: PushSubscriptionData
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    // Validate subscription data
    if (!body.endpoint || !body.keys || !body.keys.p256dh || !body.keys.auth) {
      return NextResponse.json(
        { error: 'Invalid subscription data' },
        { status: 400 }
      )
    }

    // Use admin client to store push subscription
    const admin = createAdminClient()

    // Store or update push subscription for user
    // Note: We'll need a push_subscriptions table or similar
    // For now, we'll store it in a simple table structure
    const subscriptionData = {
      user_id: userId,
      endpoint: body.endpoint,
      p256dh_key: body.keys.p256dh,
      auth_key: body.keys.auth,
      updated_at: new Date().toISOString(),
    }

    // Check if table exists, if not create it
    // For now, we'll use upsert on a table that should exist
    // If it doesn't exist, we'll need to create it first
    const { error: upsertError } = await admin
      .from('push_subscriptions')
      .upsert(subscriptionData, {
        onConflict: 'user_id',
        ignoreDuplicates: false,
      })

    if (upsertError) {
      // If table doesn't exist, log error but don't fail
      // We'll create the table via migration
      console.error('Failed to store push subscription:', upsertError)
      return NextResponse.json(
        { error: 'Failed to register push subscription. Table may not exist.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Unexpected error registering push subscription:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

