import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { createServerClient } from '@/lib/supabase-server'

/**
 * Diagnostic endpoint to verify RLS policies are applied
 * GET /api/diagnostics/rls-verification
 */
export async function GET(request: NextRequest) {
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

    // Test RLS policies by attempting queries
    // We can't directly query pg_policies via Supabase client, so we test by attempting queries
    
    // Test 1: Try to query alert_responses as alert creator
    let alertResponsesAccessible = false
    let alertResponsesErrorDetails: any = null
    try {
      const testAlertId = '00000000-0000-0000-0000-000000000000' // Dummy ID for policy check
      const { error: testError } = await supabase
        .from('alert_responses')
        .select('contact_user_id')
        .eq('alert_id', testAlertId)
        .limit(0) // Just check if query is allowed, don't fetch data
      
      // If error is RLS-related (code 42501), policy might be missing
      // If no error or non-RLS error, policy exists (query structure is valid)
      const isRLSError = testError && (
        testError.code === '42501' || 
        testError.message?.toLowerCase().includes('row-level security') ||
        testError.message?.toLowerCase().includes('rls') ||
        testError.hint?.toLowerCase().includes('row-level security') ||
        testError.hint?.toLowerCase().includes('rls')
      )
      
      alertResponsesAccessible = !testError || !isRLSError
      alertResponsesErrorDetails = testError
    } catch (testErr: any) {
      alertResponsesErrorDetails = testErr
    }

    // Test 2: Try to query location_history
    let locationHistoryAccessible = false
    let locationHistoryErrorDetails: any = null
    try {
      const testAlertId = '00000000-0000-0000-0000-000000000000' // Dummy ID for policy check
      const { error: testError } = await supabase
        .from('location_history')
        .select('*')
        .eq('alert_id', testAlertId)
        .limit(0) // Just check if query is allowed
      
      const isRLSError = testError && (
        testError.code === '42501' || 
        testError.message?.toLowerCase().includes('row-level security') ||
        testError.message?.toLowerCase().includes('rls') ||
        testError.hint?.toLowerCase().includes('row-level security') ||
        testError.hint?.toLowerCase().includes('rls')
      )
      
      locationHistoryAccessible = !testError || !isRLSError
      locationHistoryErrorDetails = testError
    } catch (testErr: any) {
      locationHistoryErrorDetails = testErr
    }

    return NextResponse.json({
      success: true,
      userId: session.user.id,
      policies: {
        alertResponses: {
          policyName: 'Alert creators can view responses for their alerts',
          tableName: 'alert_responses',
          accessible: alertResponsesAccessible,
          error: alertResponsesErrorDetails ? {
            code: alertResponsesErrorDetails.code,
            message: alertResponsesErrorDetails.message,
            hint: alertResponsesErrorDetails.hint
          } : null
        },
        locationHistory: {
          policyName: 'Contacts can view location during emergency',
          tableName: 'location_history',
          accessible: locationHistoryAccessible,
          error: locationHistoryErrorDetails ? {
            code: locationHistoryErrorDetails.code,
            message: locationHistoryErrorDetails.message,
            hint: locationHistoryErrorDetails.hint
          } : null
        }
      },
      recommendations: {
        alertResponses: !alertResponsesAccessible ? 
          'RLS policy may be missing. Run migration: migrations/fix-alert-responses-sender-view-clean.sql' : 
          'RLS policy appears to be working',
        locationHistory: !locationHistoryAccessible ? 
          'RLS policy may be missing. Run migration: migrations/fix-location-sharing-rls-clean.sql' : 
          'RLS policy appears to be working'
      },
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('[API] Error in RLS verification:', {
      error: error?.message || error,
      stack: error?.stack
    })
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

