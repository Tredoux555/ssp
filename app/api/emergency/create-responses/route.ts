import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Create alert_responses for contacts when an alert is created
 * This endpoint uses admin client to bypass RLS and create responses for other users
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Get authenticated user
    const supabase = await createServerClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { alertId, contactIds } = body

    if (!alertId || !Array.isArray(contactIds)) {
      return NextResponse.json(
        { error: 'Missing required fields: alertId, contactIds' },
        { status: 400 }
      )
    }

    // Verify the user owns this alert
    const { data: alert, error: alertError } = await supabase
      .from('emergency_alerts')
      .select('user_id')
      .eq('id', alertId)
      .single()

    if (alertError || !alert) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      )
    }

    if (alert.user_id !== session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - you can only create responses for your own alerts' },
        { status: 403 }
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
        { status: 200 }
      )
    }

    const { error: insertError } = await admin
      .from('alert_responses')
      .insert(responses)

    if (insertError) {
      console.error('Failed to create alert responses:', insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { 
        success: true, 
        message: `Created ${responses.length} alert response(s)`,
        count: responses.length 
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Error creating alert responses:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

