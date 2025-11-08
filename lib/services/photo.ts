/**
 * Photo upload service for emergency alerts
 * Handles camera capture, image compression, and upload to Supabase Storage
 * iOS-specific fixes included
 */

import { createClient } from '@/lib/supabase'
import { EmergencyPhoto } from '@/types/database'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_DIMENSION = 1280 // Reduced from 1920 for faster processing and smaller files

/**
 * Get optimal compression quality based on file size
 * Smaller files = higher quality, larger files = lower quality for faster upload
 */
function getOptimalQuality(fileSize: number): number {
  if (fileSize < 500 * 1024) return 0.75 // Small files (<500KB): 75% quality
  if (fileSize < 2 * 1024 * 1024) return 0.7 // Medium files (<2MB): 70% quality
  return 0.65 // Large files (>=2MB): 65% quality (smaller = faster upload)
}

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
 * Compress image to reduce file size (iOS-optimized, speed-optimized)
 */
function compressImage(file: File, maxWidth: number = MAX_DIMENSION, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Adaptive timeout based on file size - smaller files process faster
    const timeoutDuration = file.size > 3 * 1024 * 1024 ? 30000 : 15000
    const timeout = setTimeout(() => {
      reject(new Error('Image processing timed out. Please try a smaller photo.'))
    }, timeoutDuration)
    
    // Use adaptive quality if not provided
    const compressionQuality = quality ?? getOptimalQuality(file.size)

    const reader = new FileReader()
    
    reader.onload = (e) => {
      const img = new Image()
      
      img.onload = () => {
        try {
          clearTimeout(timeout)
          
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height
          
          // Handle EXIF orientation for iOS - only process if rotation is needed
          const orientation = (img as any).exifdata?.Orientation || 1
          const needsRotation = orientation !== 1 && orientation !== 0
          
          if (needsRotation && orientation >= 5 && orientation <= 8) {
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
            alpha: false, // No transparency needed for photos
            imageSmoothingEnabled: true, // Keep smoothing for quality
            imageSmoothingQuality: 'medium' // Balance between quality and speed
          })
          
          if (!ctx) {
            clearTimeout(timeout)
            reject(new Error('Could not get canvas context'))
            return
          }
          
          // Type guard: ensure ctx is CanvasRenderingContext2D, not ImageBitmapRenderingContext
          if (!(ctx instanceof CanvasRenderingContext2D)) {
            clearTimeout(timeout)
            reject(new Error('Invalid canvas context type'))
            return
          }

          // Only fix orientation if needed (skip if orientation is 1 - no rotation needed)
          if (needsRotation) {
            fixImageOrientation(img, canvas, ctx)
          }
          
          // Draw image
          ctx.drawImage(img, 0, 0, width, height)

          // Convert to blob with optimized quality
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
            compressionQuality
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
      
      // Handle HEIC files - iOS Safari should convert automatically, but log for debugging
      if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic')) {
        console.log('[Photo] HEIC format detected - iOS Safari should convert automatically')
        // iOS Safari typically converts HEIC to JPEG automatically when reading via FileReader
        // If conversion fails, the img.onerror handler will catch it
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
    let input: HTMLInputElement | null = null
    let cancelTimeout: NodeJS.Timeout | null = null
    let cancelled = false
    
    // Cleanup function - ensures cleanup happens even on errors
    const cleanup = () => {
      if (cancelTimeout) {
        clearTimeout(cancelTimeout)
        cancelTimeout = null
      }
      if (input && input.parentNode) {
        try {
          input.parentNode.removeChild(input)
        } catch (cleanupError) {
          console.warn('[Photo] ⚠️ Error during cleanup:', cleanupError)
        }
      }
      input = null
    }
    
    // Error handler that always cleans up
    const handleError = (errorMessage: string, userMessage?: string) => {
      if (!cancelled) {
        cancelled = true
        console.error(`[Photo] ❌ ${errorMessage}`)
        cleanup()
        if (userMessage) {
          alert(userMessage)
        }
        resolve(null)
      }
    }
    
    try {
      // Check if we're on iOS
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      
      console.log('[Photo] 📸 Starting photo capture, iOS detected:', isIOS)
      
      // Create input element
      input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*' // Use wildcard for better iOS compatibility
      input.style.display = 'none'
      input.style.position = 'absolute'
      input.style.opacity = '0'
      input.style.width = '0'
      input.style.height = '0'
      
      // iOS-specific: Use 'camera' instead of 'environment' for better compatibility
      // Also, iOS Safari may ignore capture attribute, but we set it anyway
      if (isIOS) {
        input.setAttribute('capture', 'camera')
      } else {
        input.setAttribute('capture', 'environment') // Prefer rear camera on Android
      }
      
      // Add to DOM temporarily (required for iOS Safari)
      try {
        document.body.appendChild(input)
        console.log('[Photo] ✅ File input added to DOM')
      } catch (domError: any) {
        handleError(`Failed to add input to DOM: ${domError?.message || domError}`, 
          'Failed to initialize camera. Please refresh the page and try again.')
        return
      }
      
      // Set up change handler
      input.onchange = async (e) => {
        try {
          const file = (e.target as HTMLInputElement).files?.[0]
          
          // Clear cancellation timeout since we got a file
          if (cancelTimeout) {
            clearTimeout(cancelTimeout)
            cancelTimeout = null
          }
          
          cancelled = true
          cleanup()
          
          if (!file) {
            console.log('[Photo] ⚠️ No file selected or user cancelled')
            resolve(null)
            return
          }

          console.log('[Photo] ✅ File selected:', {
            name: file.name,
            type: file.type,
            size: file.size,
            isIOS
          })

          // Check file size
          if (file.size > MAX_FILE_SIZE) {
            const sizeMB = (file.size / 1024 / 1024).toFixed(1)
            const maxMB = (MAX_FILE_SIZE / 1024 / 1024).toFixed(0)
            alert(`Image is too large (${sizeMB}MB). Maximum size is ${maxMB}MB. Please choose a smaller image.`)
            resolve(null)
            return
          }

          // Validate file type
          if (!file.type.startsWith('image/')) {
            console.error('[Photo] ❌ Invalid file type:', file.type)
            alert('Please select an image file (JPEG, PNG, etc.)')
            resolve(null)
            return
          }

          resolve(file)
        } catch (changeError: any) {
          handleError(`Error in file change handler: ${changeError?.message || changeError}`, 
            'Error processing selected file. Please try again.')
        }
      }
      
      // Set up cancellation timeout
      cancelTimeout = setTimeout(() => {
        if (!cancelled) {
          console.warn('[Photo] ⚠️ Photo selection timeout after 60 seconds')
          handleError('Photo selection timeout', 
            'Photo selection timed out. Please try again.')
        }
      }, 60000) // 60 second timeout - if no file selected, assume cancelled
      
      input.onblur = () => {
        // On iOS, blur might fire before change, so we wait a bit
        setTimeout(() => {
          if (!cancelled && input && (!input.files || input.files.length === 0)) {
            console.log('[Photo] ⚠️ User cancelled photo selection (blur event)')
            handleError('User cancelled photo selection')
          }
        }, 100)
      }
      
      // Error handler
      input.onerror = (error) => {
        handleError(`File input error: ${error}`, 
          'Failed to access camera. Please check camera permissions in your browser settings and try again.')
      }
      
      // Use setTimeout to ensure input is in DOM before clicking (iOS Safari requirement)
      setTimeout(() => {
        try {
          if (!input) {
            handleError('Input element is null', 
              'Failed to initialize camera. Please refresh the page and try again.')
            return
          }
          
          console.log('[Photo] 🖱️ Clicking file input to trigger camera...')
          input.click()
          console.log('[Photo] ✅ File input clicked successfully')
        } catch (clickError: any) {
          handleError(`Failed to trigger file input: ${clickError?.message || clickError}`, 
            'Failed to open camera. Please ensure camera permissions are granted in your browser settings.')
        }
      }, 100)
    } catch (error: any) {
      handleError(`Unexpected error in capturePhoto: ${error?.message || error}`, 
        'An unexpected error occurred while trying to access the camera. Please try again.')
    }
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
  console.log('[Photo] 🚀 uploadEmergencyPhoto called:', { 
    fileName: file.name, 
    fileSize: file.size,
    fileType: file.type,
    alertId,
    userId
  })
  
  try {
    const supabase = createClient()

    if (!supabase) {
      const errorMsg = 'Supabase client not available'
      console.error(`[Photo] ❌ ${errorMsg}`)
      window.alert('Unable to upload photo: Server configuration error. Please refresh the page and try again.')
      return null
    }

    console.log('[Photo] 📸 Starting upload process:', { 
      fileName: file.name, 
      fileSize: file.size,
      fileType: file.type,
      alertId,
      userId
    })

    // Compress image with better error handling
    let compressedBlob: Blob
    try {
      console.log('[Photo] 🖼️ Starting image compression...')
      compressedBlob = await compressImage(file)
      console.log('[Photo] ✅ Compression successful:', { 
        original: file.size, 
        compressed: compressedBlob.size,
        reduction: `${Math.round((1 - compressedBlob.size / file.size) * 100)}%`
      })
    } catch (compressError: any) {
      const errorDetails = {
        error: compressError?.message || compressError,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        stack: compressError?.stack
      }
      console.error('[Photo] ❌ Compression failed:', errorDetails)
      const errorMsg = compressError?.message || 'Failed to process image'
      window.alert(`Image processing failed: ${errorMsg}\n\nPlease try:\n- A smaller photo\n- A different image format (JPEG or PNG)\n- Refreshing the page`)
      return null
    }

    // Validate compressed blob
    if (!compressedBlob || compressedBlob.size === 0) {
      const errorMsg = 'Compression resulted in empty file'
      console.error(`[Photo] ❌ ${errorMsg}`)
      window.alert('Image processing failed: The compressed image is empty. Please try a different photo.')
      return null
    }

    // Create File object from blob with proper type
    const compressedFile = new File([compressedBlob], `photo_${Date.now()}.jpg`, { 
      type: 'image/jpeg',
      lastModified: Date.now()
    })

    console.log('[Photo] 📦 Created compressed file:', {
      name: compressedFile.name,
      size: compressedFile.size,
      type: compressedFile.type
    })

    // Generate unique filename - will regenerate on retry if needed
    let photoId = crypto.randomUUID()
    let fileName = `${photoId}.jpg`
    let storagePath = `${alertId}/${fileName}`

    // Upload to Supabase Storage with retry logic and timeout protection
    console.log('[Photo] 📤 Starting storage upload...', { 
      storagePath, 
      fileSize: compressedFile.size,
      attempt: 1,
      maxRetries: 4
    })
    
    let uploadData: any = null
    let uploadError: any = null
    const maxRetries = 3
    const uploadTimeout = 30000 // 30 second timeout per attempt
    let retries = 0
    
    // Retry loop for network errors
    while (retries <= maxRetries) {
      try {
        console.log(`[Photo] 📤 Upload attempt ${retries + 1}/${maxRetries + 1}...`, { storagePath })
        
        // Wrap upload in timeout to prevent hanging indefinitely
        const uploadPromise = supabase.storage
          .from('emergency-photos')
          .upload(storagePath, compressedFile, {
            contentType: 'image/jpeg',
            upsert: false,
            cacheControl: '3600',
          })
        
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Upload timeout after 30 seconds')), uploadTimeout)
        })
        
        const result = await Promise.race([uploadPromise, timeoutPromise]) as any
        
        uploadData = result.data
        uploadError = result.error
        
        // Success - exit retry loop
        if (!uploadError) {
          console.log(`[Photo] ✅ Upload successful on attempt ${retries + 1}`, { storagePath })
          break
        }
        
        // Get error details
        const errorMessage = uploadError.message || ''
        const errorName = (uploadError as any).name || ''
        const statusCode = uploadError.statusCode || (uploadError as any).status
        
        console.warn(`[Photo] ⚠️ Upload attempt ${retries + 1} failed:`, {
          errorMessage,
          errorName,
          statusCode,
          storagePath
        })
        
        // Handle 409 - file already exists (might have been uploaded in previous attempt)
        if (statusCode === 409 || statusCode === '409' || errorMessage.includes('already exists')) {
          console.warn(`[Photo] ⚠️ File already exists (409) - checking if upload succeeded...`)
          
          // Check if file actually exists and is accessible
          try {
            const { data: fileList, error: listError } = await supabase.storage
              .from('emergency-photos')
              .list(alertId, {
                search: fileName
              })
            
            if (!listError && fileList && fileList.some((f: any) => f.name === fileName)) {
              // File exists! The upload actually succeeded, just got 409 on retry
              console.log(`[Photo] ✅ File exists - previous upload succeeded, proceeding...`)
              uploadError = null // Clear error - treat as success
              uploadData = { path: storagePath } // Create mock data
              break
            } else {
              // File doesn't exist but we got 409 - generate new filename and retry
              console.warn(`[Photo] ⚠️ 409 error but file not found - generating new filename`)
              photoId = crypto.randomUUID()
              fileName = `${photoId}.jpg`
              storagePath = `${alertId}/${fileName}`
              
              if (retries < maxRetries) {
                retries++
                const retryDelay = Math.min(1000 * Math.pow(2, retries - 1), 5000)
                console.warn(`[Photo] ⚠️ Retrying with new filename in ${retryDelay}ms...`)
                await new Promise(resolve => setTimeout(resolve, retryDelay))
                continue
              } else {
                // Max retries reached even with new filename
                console.error(`[Photo] ❌ Upload failed after ${maxRetries + 1} attempts (409 error)`)
                break
              }
            }
          } catch (checkErr: any) {
            console.error('[Photo] ❌ Error checking file existence:', checkErr)
            // Generate new filename and retry
            photoId = crypto.randomUUID()
            fileName = `${photoId}.jpg`
            storagePath = `${alertId}/${fileName}`
            
            if (retries < maxRetries) {
              retries++
              const retryDelay = Math.min(1000 * Math.pow(2, retries - 1), 5000)
              console.warn(`[Photo] ⚠️ Retrying with new filename after check error in ${retryDelay}ms...`)
              await new Promise(resolve => setTimeout(resolve, retryDelay))
              continue
            }
            break
          }
        }
        
        // Check if it's a retryable error (network error, not permission/bucket errors)
        const isRetryableError = (
          (errorMessage.includes('Load failed') || 
           errorMessage.includes('Failed to fetch') ||
           errorMessage.includes('timeout') ||
           errorName === 'NetworkError') &&
          !statusCode // No status code means network issue, not policy issue
        ) || (
          statusCode >= 500 // Server errors (500+) are retryable
        )
        
        // Don't retry permission errors or bucket not found
        if (statusCode === 403 || statusCode === 404 || !isRetryableError) {
          console.error(`[Photo] ❌ Non-retryable error (${statusCode || 'unknown'}), not retrying`)
          break // Exit retry loop - not retryable
        }
        
        // Retryable error - generate new filename and retry
        if (retries < maxRetries) {
          retries++
          // Generate new filename for retry to avoid conflicts
          photoId = crypto.randomUUID()
          fileName = `${photoId}.jpg`
          storagePath = `${alertId}/${fileName}`
          
          const retryDelay = Math.min(1000 * Math.pow(2, retries - 1), 5000) // Exponential backoff: 1s, 2s, 4s
          console.warn(`[Photo] ⚠️ Upload attempt ${retries} failed, retrying with new filename in ${retryDelay}ms...`, {
            error: errorMessage || errorName,
            attempt: retries,
            maxRetries: maxRetries + 1,
            newStoragePath: storagePath
          })
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          continue
        } else {
          // Max retries reached
          console.error(`[Photo] ❌ Upload failed after ${maxRetries + 1} attempts`)
          break
        }
      } catch (err: any) {
        uploadError = err
        const errorMessage = err?.message || ''
        const errorName = err?.name || ''
        
        console.error(`[Photo] ❌ Upload exception on attempt ${retries + 1}:`, {
          error: errorMessage || errorName,
          stack: err?.stack,
          name: errorName
        })
        
        // Check if it's a timeout error
        const isTimeoutError = errorMessage.includes('timeout') || errorMessage.includes('Timeout')
        const isRetryableError = errorMessage.includes('Load failed') || 
                                errorMessage.includes('Failed to fetch') ||
                                errorMessage.includes('timeout') ||
                                errorName === 'NetworkError'
        
        if (isRetryableError && retries < maxRetries) {
          retries++
          // Generate new filename for retry
          photoId = crypto.randomUUID()
          fileName = `${photoId}.jpg`
          storagePath = `${alertId}/${fileName}`
          
          const retryDelay = Math.min(1000 * Math.pow(2, retries - 1), 5000)
          console.warn(`[Photo] ⚠️ Upload ${isTimeoutError ? 'timeout' : 'exception'} on attempt ${retries}, retrying with new filename in ${retryDelay}ms...`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          continue
        }
        // Not retryable or max retries reached
        break
      }
    }

    if (uploadError) {
      const errorMessage = uploadError.message || ''
      const errorName = (uploadError as any).name || ''
      const statusCode = uploadError.statusCode || (uploadError as any).status
      
      console.error('[Photo] ❌ Storage upload failed after all retries:', {
        code: statusCode,
        message: errorMessage,
        name: errorName,
        error: uploadError,
        status: (uploadError as any).status,
        stack: (uploadError as any).stack,
        retriesAttempted: retries
      })
      
      // Check for 403 first (permission denied) - most likely RLS/policy issue
      if (statusCode === '403' || statusCode === 403) {
        const userMsg = `Permission denied (403). Storage policies may need to be configured.\n\nError: ${errorMessage || 'Unknown'}\n\nPlease check that storage policies were created correctly in Supabase.`
        console.error('[Photo] ❌ 403 Permission denied - storage policies may be blocking')
        window.alert(userMsg)
        return null
      }
      
      // Check for bucket not found (404)
      if (uploadError.message?.includes('Bucket not found') || 
          uploadError.message?.includes('does not exist') ||
          statusCode === '404' ||
          statusCode === 404) {
        console.error('[Photo] ❌ Bucket not found (404)')
        window.alert('Photo storage not configured. Setting up now...')
        // Try to auto-setup bucket
        try {
          const setupResponse = await fetch('/api/storage/setup-bucket', { method: 'POST' })
          const setupResult = await setupResponse.json()
          if (setupResult.success) {
            if (setupResult.policySetupRequired) {
              window.alert('Storage bucket created! However, you must run the storage policies SQL migration before uploading photos. Go to Supabase Dashboard → SQL Editor and run: migrations/add-emergency-photos-storage-policies.sql')
            } else {
              window.alert('Storage bucket created! Please try uploading again.')
            }
          } else {
            window.alert(`Setup failed: ${setupResult.error || 'Unknown error'}. Please create the bucket manually in Supabase Storage.`)
          }
        } catch (setupError: any) {
          console.error('[Photo] ❌ Failed to auto-setup bucket:', setupError)
          window.alert('Could not auto-setup storage. Please create "emergency-photos" bucket in Supabase Storage and run migrations/add-emergency-photos-storage-policies.sql')
        }
        return null
      }
      
      // Check for network errors
      const isNetworkError = errorMessage.includes('Load failed') || 
                           errorMessage.includes('Failed to fetch') ||
                           errorName === 'NetworkError'
      
      // Only treat as policy issue if it's a network error AND we don't have a specific status code
      if (isNetworkError && !statusCode) {
        const userMsg = `Upload failed: Network error.\n\nError: ${errorMessage || errorName}\n\nPlease check:\n- Your internet connection\n- Browser console for details\n- Storage policies are configured`
        console.error('[Photo] ❌ Network error detected (no status code) - may be CORS or policy issue')
        window.alert(userMsg)
        return null
      }
      
      // Generic error fallback - show actual error message
      const userMsg = `Failed to upload photo after ${retries + 1} attempt(s).\n\nError: ${errorMessage || errorName || 'Unknown error'}\nStatus: ${statusCode || 'N/A'}\n\nPlease try again or check console for details.`
      window.alert(userMsg)
      return null
    }

    console.log('[Photo] ✅ Storage upload successful:', uploadData)

    // Save metadata to database
    console.log('[Photo] 💾 Saving photo metadata to database...', { storagePath, fileName })
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
      const errorDetails = {
        code: dbError.code,
        message: dbError.message,
        details: dbError.details,
        hint: dbError.hint
      }
      console.error('[Photo] ❌ Database insert failed:', errorDetails)
      
      // Try to delete uploaded file if database insert fails
      try {
        console.log('[Photo] 🗑️ Attempting to cleanup uploaded file...')
        await supabase.storage.from('emergency-photos').remove([storagePath])
        console.log('[Photo] ✅ Cleaned up uploaded file')
      } catch (cleanupError: any) {
        console.warn('[Photo] ⚠️ Failed to cleanup uploaded file:', cleanupError)
      }
      
      // Check for specific errors
      if (dbError.code === '42P01' || dbError.message?.includes('does not exist')) {
        const userMsg = 'Photo feature not configured.\n\nThe emergency_photos table does not exist.\n\nPlease run database migrations.'
        window.alert(userMsg)
      } else if (dbError.code === '42501' || dbError.message?.includes('row-level security')) {
        const userMsg = 'Permission denied.\n\nDatabase policies may need to be configured.\n\nError: ' + (dbError.message || 'Unknown')
        window.alert(userMsg)
      } else {
        const userMsg = `Failed to save photo metadata:\n\n${dbError.message || 'Unknown error'}\n\nCode: ${dbError.code || 'N/A'}`
        window.alert(userMsg)
      }
      return null
    }

    console.log('[Photo] ✅ Photo uploaded and saved successfully:', {
      photoId: photoData.id,
      alertId,
      fileSize: compressedFile.size,
      storagePath
    })

    return photoData as EmergencyPhoto
  } catch (error: any) {
    const errorDetails = {
      error: error?.message || error,
      stack: error?.stack,
      name: error?.name,
      fileName: file.name,
      fileSize: file.size
    }
    console.error('[Photo] ❌ Unexpected error in uploadEmergencyPhoto:', errorDetails)
    const userMsg = `Failed to upload photo: ${error?.message || 'Unknown error'}\n\nPlease try again or check console for details.`
    window.alert(userMsg)
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

