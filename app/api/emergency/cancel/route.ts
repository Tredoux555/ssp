import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    
    if (!supabase) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Get authenticated user
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Parse request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const { alert_id } = body

    if (!alert_id || typeof alert_id !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid required field: alert_id' },
        { status: 400 }
      )
    }

    // Verify the alert belongs to the user and is active
    const { data: alert, error: fetchError } = await supabase
      .from('emergency_alerts')
      .select('id, status, user_id')
      .eq('id', alert_id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !alert) {
      return NextResponse.json(
        { error: 'Alert not found or access denied' },
        { status: 404 }
      )
    }

    if (alert.status !== 'active') {
      return NextResponse.json(
        { error: 'Alert is not active and cannot be cancelled' },
        { status: 400 }
      )
    }

    // Cancel the alert
    const { error, data } = await supabase
      .from('emergency_alerts')
      .update({ 
        status: 'cancelled', 
        resolved_at: new Date().toISOString() 
      })
      .eq('id', alert_id)
      .eq('user_id', userId)
      .eq('status', 'active') // Double-check it's still active
      .select()

    if (error) {
      console.error('Error cancelling emergency alert:', error)
      // Check if it's a permission error vs not found
      if (error.code === '42501' || error.message.includes('row-level security')) {
        return NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to cancel emergency alert' },
        { status: 500 }
      )
    }

    // Check if any rows were updated
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Alert not found or already cancelled' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, alert: data[0] }, { status: 200 })
  } catch (error: any) {
    console.error('Unexpected error cancelling emergency alert:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

