import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const results: any = {
      timestamp: new Date().toISOString(),
      tests: [],
    }

    // Test 1: Admin client creation
    try {
      const admin = createAdminClient()
      results.tests.push({
        name: 'Admin Client Creation',
        status: 'success',
        message: 'Admin client created successfully',
      })
    } catch (error: any) {
      results.tests.push({
        name: 'Admin Client Creation',
        status: 'error',
        message: `Failed to create admin client: ${error.message}`,
        error: error.message,
      })
      return NextResponse.json(results, { status: 500 })
    }

    // Test 2: Database connection
    try {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('emergency_alerts')
        .select('id')
        .limit(1)

      if (error) {
        results.tests.push({
          name: 'Database Connection',
          status: 'error',
          message: `Database query failed: ${error.message}`,
          error: error,
        })
      } else {
        results.tests.push({
          name: 'Database Connection',
          status: 'success',
          message: 'Successfully queried database',
        })
      }
    } catch (error: any) {
      results.tests.push({
        name: 'Database Connection',
        status: 'error',
        message: `Database connection error: ${error.message}`,
        error: error.message,
      })
    }

    // Test 3: Check Realtime publication
    try {
      const admin = createAdminClient()
      // Query to check if emergency_alerts is in Realtime publication
      const { data: pubData, error: pubError } = await admin.rpc('get_realtime_publication_tables', {}).catch(() => ({ data: null, error: null }))
      
      // Alternative: Try to query pg_publication_tables directly
      const { data: tableData, error: tableError } = await admin
        .from('pg_publication_tables')
        .select('*')
        .eq('tablename', 'emergency_alerts')
        .limit(1)

      if (tableError) {
        // Can't query system tables directly, try alternative approach
        results.tests.push({
          name: 'Realtime Publication',
          status: 'warning',
          message: 'Cannot verify Realtime publication status (requires SQL query)',
          note: 'Check Supabase Dashboard > Database > Replication to verify emergency_alerts is enabled',
        })
      } else {
        results.tests.push({
          name: 'Realtime Publication',
          status: tableData && tableData.length > 0 ? 'success' : 'warning',
          message: tableData && tableData.length > 0
            ? 'emergency_alerts appears to be in Realtime publication'
            : 'emergency_alerts may not be in Realtime publication',
          note: 'Verify in Supabase Dashboard > Database > Replication',
        })
      }
    } catch (error: any) {
      results.tests.push({
        name: 'Realtime Publication',
        status: 'warning',
        message: 'Could not check Realtime publication status',
        error: error.message,
      })
    }

    // Test 4: Check RLS policies
    try {
      const admin = createAdminClient()
      // Query pg_policies to check if policies exist
      const { data: policyData, error: policyError } = await admin
        .from('pg_policies')
        .select('policyname')
        .eq('tablename', 'emergency_alerts')
        .eq('policyname', 'Contacts can view notified alerts')
        .limit(1)

      if (policyError) {
        results.tests.push({
          name: 'RLS Policies',
          status: 'warning',
          message: 'Cannot verify RLS policies (requires SQL query)',
          note: 'Run migrations/fix-emergency-alerts-comprehensive.sql to ensure policies exist',
        })
      } else {
        results.tests.push({
          name: 'RLS Policies',
          status: policyData && policyData.length > 0 ? 'success' : 'error',
          message: policyData && policyData.length > 0
            ? 'RLS policy "Contacts can view notified alerts" exists'
            : 'RLS policy "Contacts can view notified alerts" not found',
          note: policyData && policyData.length > 0
            ? 'Policy is configured'
            : 'Run migrations/fix-emergency-alerts-comprehensive.sql',
        })
      }
    } catch (error: any) {
      results.tests.push({
        name: 'RLS Policies',
        status: 'warning',
        message: 'Could not check RLS policies',
        error: error.message,
      })
    }

    // Test 5: Check push_subscriptions table
    try {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('push_subscriptions')
        .select('id')
        .limit(1)

      if (error) {
        results.tests.push({
          name: 'Push Subscriptions Table',
          status: 'error',
          message: `push_subscriptions table error: ${error.message}`,
          note: 'Run migrations/add-push-subscriptions.sql',
        })
      } else {
        results.tests.push({
          name: 'Push Subscriptions Table',
          status: 'success',
          message: 'push_subscriptions table exists',
        })
      }
    } catch (error: any) {
      results.tests.push({
        name: 'Push Subscriptions Table',
        status: 'error',
        message: `Error checking push_subscriptions: ${error.message}`,
      })
    }

    // Test 6: Environment variables check
    const envCheck = {
      name: 'Environment Variables',
      status: 'success' as string,
      message: 'Environment variables check',
      details: {} as any,
    }

    const requiredVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]

    const optionalVars = [
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_EMAIL',
    ]

    for (const varName of requiredVars) {
      const value = process.env[varName]
      envCheck.details[varName] = value ? 'Set' : 'Missing'
      if (!value) {
        envCheck.status = 'error'
      }
    }

    for (const varName of optionalVars) {
      const value = process.env[varName]
      envCheck.details[varName] = value ? 'Set' : 'Not set (optional)'
      if (!value && varName.startsWith('VAPID')) {
        envCheck.status = envCheck.status === 'error' ? 'error' : 'warning'
      }
    }

    if (envCheck.status === 'success') {
      envCheck.message = 'All required environment variables are set'
    } else if (envCheck.status === 'error') {
      envCheck.message = 'Missing required environment variables'
    } else {
      envCheck.message = 'Required variables set, but some optional variables missing'
    }

    results.tests.push(envCheck)

    // Calculate overall status
    const hasErrors = results.tests.some((t: any) => t.status === 'error')
    const hasWarnings = results.tests.some((t: any) => t.status === 'warning')
    results.overallStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'success'

    return NextResponse.json(results, { status: 200 })
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'Failed to run diagnostics',
        message: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}


