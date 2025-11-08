import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Create alert_responses for contacts when an alert is created
 * This endpoint uses admin client to bypass RLS and create responses for other users
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Add CORS headers for cross-origin requests (if needed)
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    // Handle OPTIONS request for CORS preflight
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 200, headers })
    }

    // Get authenticated user
    const supabase = await createServerClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      )
    }

    if (!alertId || !Array.isArray(contactIds)) {
      return NextResponse.json(
        { error: 'Missing required fields: alertId, contactIds' },
        { status: 400, headers }
      )
    }

    // Verify the user owns this alert (with retry logic for timing issues)
    let alert: { user_id: string } | null = null
    let alertError = null
    let retries = 3
    let delay = 500
    
    while (retries > 0) {
      const result = await supabase
        .from('emergency_alerts')
        .select('user_id')
        .eq('id', alertId)
        .single()
      
      alert = result.data
      alertError = result.error
      
      if (alertError || !alert) {
        if (retries > 1) {
          // Retry after delay (alert might not be visible yet due to RLS)
          retries--
          await new Promise(resolve => setTimeout(resolve, delay))
          delay *= 2 // Exponential backoff
          continue
        }
        return NextResponse.json(
          { error: 'Alert not found' },
          { status: 404, headers }
        )
      }
      break // Success
    }

    // TypeScript guard: ensure alert is not null
    if (!alert || !alert.user_id) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404, headers }
      )
    }

    if (alert.user_id !== session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - you can only create responses for your own alerts' },
        { status: 403, headers }
      )
    }

    // Use admin client to create responses (bypasses RLS)
    const admin = createAdminClient()
    
    const responses = contactIds
      .filter((id: any): id is string => !!id && typeof id === 'string')
      .map((contactId: string) => ({
        alert_id: alertId,
        contact_user_id: contactId,
      }))

    if (responses.length === 0) {
      return NextResponse.json(
        { success: true, message: 'No valid contact IDs provided' },
        { status: 200, headers }
      )
    }

    const { error: insertError } = await admin
      .from('alert_responses')
      .insert(responses)

    if (insertError) {
      console.error('Failed to create alert responses:', insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500, headers }
      )
    }

    return NextResponse.json(
      { 
        success: true, 
        message: `Created ${responses.length} alert response(s)`,
        count: responses.length 
      },
      { status: 200, headers }
    )
  } catch (error: any) {
    console.error('Error creating alert responses:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

