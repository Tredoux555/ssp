import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const params = await context.params
    const contactId = params.id

    if (!contactId || typeof contactId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid contact ID' },
        { status: 400 }
      )
    }

    // Use admin client to bypass RLS for deletion
    // Authentication is already verified above, so it's safe to use admin client
    // This follows the same pattern as app/api/emergency/cancel/route.ts
    const admin = createAdminClient()

    // Verify the contact belongs to the user (using admin client to bypass RLS)
    const { data: contact, error: fetchError } = await admin
      .from('emergency_contacts')
      .select('id, user_id')
      .eq('id', contactId)
      .eq('user_id', userId) // Explicit ownership check
      .single()

    if (fetchError || !contact) {
      return NextResponse.json(
        { error: 'Contact not found or access denied' },
        { status: 404 }
      )
    }

    // Delete the contact using admin client (bypasses RLS)
    const { error: deleteError, data: deletedData } = await admin
      .from('emergency_contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', userId) // Extra safety: verify ownership even with admin client
      .select()

    if (deleteError) {
      console.error('Error deleting contact:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete contact' },
        { status: 500 }
      )
    }

    // Check if any rows were deleted
    if (!deletedData || deletedData.length === 0) {
      return NextResponse.json(
        { error: 'Contact not found or already deleted' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, contact: deletedData[0] }, { status: 200 })
  } catch (error: any) {
    console.error('Unexpected error deleting contact:', {
      error,
      errorType: typeof error,
      errorConstructor: error?.constructor?.name,
      message: error?.message,
      stack: error?.stack,
    })
    
    // Provide more detailed error message for debugging
    const errorMessage = error?.message || 'Internal server error'
    return NextResponse.json(
      { 
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && {
          details: {
            message: errorMessage,
            type: typeof error,
            constructor: error?.constructor?.name,
          }
        })
      },
      { status: 500 }
    )
  }
}

