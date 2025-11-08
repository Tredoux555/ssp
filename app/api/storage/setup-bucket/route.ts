import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * API endpoint to create the emergency-photos storage bucket
 * This uses the service role key to bypass RLS
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Missing Supabase configuration' },
        { status: 500 }
      )
    }

    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Check if bucket already exists
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets()
    
    if (listError) {
      console.error('[Storage Setup] Error listing buckets:', listError)
      return NextResponse.json(
        { error: `Failed to check buckets: ${listError.message}` },
        { status: 500 }
      )
    }

    const bucketExists = buckets?.some((b) => b.name === 'emergency-photos')

    if (bucketExists) {
      return NextResponse.json({
        success: true,
        message: 'Bucket already exists',
        bucket: buckets?.find((b) => b.name === 'emergency-photos'),
      })
    }

    // Create the bucket
    const { data: bucket, error: createError } = await supabaseAdmin.storage.createBucket(
      'emergency-photos',
      {
        public: true, // Make bucket public so receivers can view photos
        allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png'],
        fileSizeLimit: 5242880, // 5MB
      }
    )

    if (createError) {
      console.error('[Storage Setup] Error creating bucket:', createError)
      return NextResponse.json(
        { error: `Failed to create bucket: ${createError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Bucket created successfully',
      bucket,
    })
  } catch (error: any) {
    console.error('[Storage Setup] Unexpected error:', error)
    return NextResponse.json(
      { error: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

