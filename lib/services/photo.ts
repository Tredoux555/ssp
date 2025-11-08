/**
 * Photo upload service for emergency alerts
 * Handles camera capture, image compression, and upload to Supabase Storage
 * iOS-specific fixes included
 */

import { createClient } from '@/lib/supabase'
import { EmergencyPhoto } from '@/types/database'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_DIMENSION = 1920 // Max width/height in pixels

/**
 * Fix image orientation based on EXIF data (iOS fix)
 */
function fixImageOrientation(img: HTMLImageElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  // Get EXIF orientation from image (if available)
  const orientation = (img as any).exifdata?.Orientation || 1
  
  // iOS Safari sometimes doesn't respect EXIF, so we handle it manually
  // Most common: orientation 6 (90° clockwise) and 8 (90° counter-clockwise)
  switch (orientation) {
    case 2:
      // Horizontal flip
      ctx.transform(-1, 0, 0, 1, canvas.width, 0)
      break
    case 3:
      // 180° rotation
      ctx.transform(-1, 0, 0, -1, canvas.width, canvas.height)
      break
    case 4:
      // Vertical flip
      ctx.transform(1, 0, 0, -1, 0, canvas.height)
      break
    case 5:
      // Vertical flip + 90° clockwise
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      // 90° clockwise
      ctx.transform(0, 1, -1, 0, canvas.height, 0)
      break
    case 7:
      // Horizontal flip + 90° clockwise
      ctx.transform(0, -1, -1, 0, canvas.height, canvas.width)
      break
    case 8:
      // 90° counter-clockwise
      ctx.transform(0, -1, 1, 0, 0, canvas.width)
      break
    default:
      // No transformation needed
      break
  }
}

/**
 * Compress image to reduce file size (iOS-optimized)
 */
function compressImage(file: File, maxWidth: number = MAX_DIMENSION, quality: number = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Add timeout for iOS devices (they can be slower)
    const timeout = setTimeout(() => {
      reject(new Error('Image processing timed out. Please try a smaller photo.'))
    }, 30000) // 30 seconds

    const reader = new FileReader()
    
    reader.onload = (e) => {
      const img = new Image()
      
      img.onload = () => {
        try {
          clearTimeout(timeout)
          
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height
          
          // Handle EXIF orientation for iOS
          // If image is rotated in EXIF, swap dimensions
          const orientation = (img as any).exifdata?.Orientation || 1
          if (orientation >= 5 && orientation <= 8) {
            // Dimensions are swapped for rotated images
            [width, height] = [height, width]
          }

          // Calculate new dimensions
          if (width > height) {
            if (width > maxWidth) {
              height = (height * maxWidth) / width
              width = maxWidth
            }
          } else {
            if (height > maxWidth) {
              width = (width * maxWidth) / height
              height = maxWidth
            }
          }

          // Set canvas size
          canvas.width = width
          canvas.height = height

          const ctx = canvas.getContext('2d', { 
            willReadFrequently: false, // Better performance on iOS
            alpha: false // No transparency needed for photos
          })
          
          if (!ctx) {
            clearTimeout(timeout)
            reject(new Error('Could not get canvas context'))
            return
          }

          // Fix orientation if needed
          fixImageOrientation(img, canvas, ctx)
          
          // Draw image
          ctx.drawImage(img, 0, 0, width, height)

          // Convert to blob with error handling
          canvas.toBlob(
            (blob) => {
              clearTimeout(timeout)
              if (blob) {
                resolve(blob)
              } else {
                reject(new Error('Failed to compress image. Try a different photo.'))
              }
            },
            'image/jpeg', // Always JPEG for compatibility
            quality
          )
        } catch (error: any) {
          clearTimeout(timeout)
          reject(new Error(`Image processing failed: ${error.message || 'Unknown error'}`))
        }
      }
      
      img.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('Failed to load image. Unsupported format (try JPEG or PNG).'))
      }
      
      // Handle HEIC files - convert to data URL
      if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic')) {
        // iOS Safari should convert HEIC automatically, but if not, show error
        console.warn('[Photo] HEIC format detected - may need conversion')
      }
      
      img.src = e.target?.result as string
    }
    
    reader.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Failed to read file'))
    }
    
    // Use DataURL for better iOS compatibility
    reader.readAsDataURL(file)
  })
}

/**
 * Capture photo from camera or file picker (iOS-optimized)
 */
export async function capturePhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/heic,image/heif' // Include HEIC
    input.capture = 'environment' // Prefer rear camera on mobile

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) {
        resolve(null)
        return
      }

      console.log('[Photo] File selected:', {
        name: file.name,
        type: file.type,
        size: file.size
      })

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        alert(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
        resolve(null)
        return
      }

      resolve(file)
    }

    input.click()
  })
}

/**
 * Upload photo to Supabase Storage and save metadata to database
 */
export async function uploadEmergencyPhoto(
  alertId: string,
  userId: string,
  file: File
): Promise<EmergencyPhoto | null> {
  try {
    const supabase = createClient()

    if (!supabase) {
      console.error('[Photo] ❌ Supabase client not available')
      window.alert('Unable to upload photo: Server configuration error')
      return null
    }

    console.log('[Photo] 📸 Starting upload:', { 
      fileName: file.name, 
      fileSize: file.size,
      fileType: file.type 
    })

    // Compress image with better error handling
    let compressedBlob: Blob
    try {
      compressedBlob = await compressImage(file)
      console.log('[Photo] ✅ Compressed:', { 
        original: file.size, 
        compressed: compressedBlob.size,
        reduction: `${Math.round((1 - compressedBlob.size / file.size) * 100)}%`
      })
    } catch (compressError: any) {
      console.error('[Photo] ❌ Compression failed:', compressError)
      const errorMsg = compressError.message || 'Failed to process image'
      window.alert(`${errorMsg}. Please try a smaller photo or different format.`)
      return null
    }

    // Create File object from blob with proper type
    const compressedFile = new File([compressedBlob], `photo_${Date.now()}.jpg`, { 
      type: 'image/jpeg',
      lastModified: Date.now()
    })

    // Generate unique filename
    const photoId = crypto.randomUUID()
    const fileName = `${photoId}.jpg` // Always use .jpg extension
    const storagePath = `${alertId}/${fileName}`

    // Upload to Supabase Storage
    console.log('[Photo] 📤 Uploading to storage...', { storagePath, fileSize: compressedFile.size })
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('emergency-photos')
      .upload(storagePath, compressedFile, {
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '3600',
      })

    if (uploadError) {
      console.error('[Photo] ❌ Storage error:', {
        code: uploadError.statusCode,
        message: uploadError.message,
        error: uploadError,
        status: (uploadError as any).status
      })
      
      // Check for bucket not found
      if (uploadError.message?.includes('Bucket not found') || 
          uploadError.message?.includes('does not exist') ||
          uploadError.statusCode === '404' ||
          (uploadError as any).status === 404) {
        window.alert('Photo storage not configured. Setting up now...')
        // Try to auto-setup bucket
        try {
          const setupResponse = await fetch('/api/storage/setup-bucket', { method: 'POST' })
          const setupResult = await setupResponse.json()
          if (setupResult.success) {
            window.alert('Storage bucket created! Please try uploading again.')
          } else {
            window.alert(`Setup failed: ${setupResult.error || 'Unknown error'}. Please create the bucket manually in Supabase.`)
          }
        } catch (setupError: any) {
          console.error('[Photo] Failed to auto-setup bucket:', setupError)
          window.alert('Could not auto-setup storage. Please create "emergency-photos" bucket in Supabase Storage.')
        }
      } else if (uploadError.statusCode === '403' || 
                 uploadError.message?.includes('policy') ||
                 (uploadError as any).status === 403) {
        window.alert('Permission denied. Storage policies may need to be configured.')
      } else {
        window.alert(`Failed to upload: ${uploadError.message || 'Unknown error'}. Please try again.`)
      }
      return null
    }

    console.log('[Photo] ✅ Storage upload successful:', uploadData)

    // Save metadata to database
    const { data: photoData, error: dbError } = await supabase
      .from('emergency_photos')
      .insert({
        alert_id: alertId,
        user_id: userId,
        storage_path: storagePath,
        file_name: fileName,
        file_size: compressedFile.size,
        mime_type: 'image/jpeg',
      })
      .select()
      .single()

    if (dbError) {
      console.error('[Photo] ❌ Database error:', {
        code: dbError.code,
        message: dbError.message,
        details: dbError.details
      })
      
      // Try to delete uploaded file if database insert fails
      try {
        await supabase.storage.from('emergency-photos').remove([storagePath])
        console.log('[Photo] 🗑️ Cleaned up uploaded file')
      } catch (cleanupError) {
        console.warn('[Photo] ⚠️ Failed to cleanup:', cleanupError)
      }
      
      // Check for specific errors
      if (dbError.code === '42P01' || dbError.message?.includes('does not exist')) {
        window.alert('Photo feature not configured. Please run database migrations.')
      } else if (dbError.code === '42501' || dbError.message?.includes('row-level security')) {
        window.alert('Permission denied. Database policies may need to be configured.')
      } else {
        window.alert(`Failed to save photo: ${dbError.message || 'Unknown error'}`)
      }
      return null
    }

    console.log('[Photo] ✅ Photo uploaded successfully:', {
      photoId: photoData.id,
      alertId,
      fileSize: compressedFile.size,
    })

    return photoData as EmergencyPhoto
  } catch (error: any) {
    console.error('[Photo] ❌ Unexpected error:', {
      error: error?.message || error,
      stack: error?.stack,
      name: error?.name
    })
    window.alert(`Failed to upload photo: ${error?.message || 'Unknown error'}. Please try again.`)
    return null
  }
}

/**
 * Get public URL for a photo
 */
export function getPhotoUrl(storagePath: string): string {
  const supabase = createClient()
  const { data } = supabase.storage.from('emergency-photos').getPublicUrl(storagePath)
  return data.publicUrl
}

/**
 * Fetch photos for an alert
 */
export async function getAlertPhotos(alertId: string): Promise<EmergencyPhoto[]> {
  try {
    const supabase = createClient()
    
    if (!supabase) {
      console.warn('[Photo] Supabase client not available')
      return []
    }
    
    const { data, error } = await supabase
      .from('emergency_photos')
      .select('*')
      .eq('alert_id', alertId)
      .order('created_at', { ascending: false })

    if (error) {
      // Properly serialize error to see all properties
      const errorDetails = {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        status: (error as any).status,
        statusCode: (error as any).statusCode,
        // Try to get all enumerable properties
        ...(error as any),
      }
      
      // Check if it's an RLS error or table doesn't exist
      const isRLSError = error.code === '42501' || 
                         error.message?.includes('row-level security') || 
                         error.message?.includes('RLS') ||
                         errorDetails.status === 403
      const tableNotExists = error.code === '42P01' || 
                             error.message?.includes('does not exist') ||
                             error.message?.includes('relation "emergency_photos" does not exist')
      
      if (tableNotExists) {
        console.warn('[Photo] ⚠️ emergency_photos table does not exist. Run migration: migrations/add-emergency-photos-table.sql')
      } else if (isRLSError) {
        console.warn('[Photo] ⚠️ RLS policy blocking photo fetch. This is expected if migration not run yet.')
      } else {
        // Log full error details using JSON.stringify to see all properties
        try {
          console.error('[Photo] Error fetching photos:', JSON.stringify(errorDetails, null, 2))
        } catch {
          // Fallback if JSON.stringify fails
          console.error('[Photo] Error fetching photos:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
            alertId,
            rawError: String(error)
          })
        }
      }
      return []
    }

    return (data || []) as EmergencyPhoto[]
  } catch (error: any) {
    console.error('[Photo] Failed to fetch photos:', {
      error: error?.message || error,
      code: error?.code,
      alertId
    })
    return []
  }
}

