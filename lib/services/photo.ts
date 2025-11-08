/**
 * Photo upload service for emergency alerts
 * Handles camera capture, image compression, and upload to Supabase Storage
 */

import { createClient } from '@/lib/supabase'
import { EmergencyPhoto } from '@/types/database'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_DIMENSION = 1920 // Max width/height in pixels

/**
 * Compress image to reduce file size
 */
function compressImage(file: File, maxWidth: number = MAX_DIMENSION, quality: number = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

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

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not get canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Failed to compress image'))
            }
          },
          'image/jpeg',
          quality
        )
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Capture photo from camera or file picker
 */
export async function capturePhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment' // Prefer rear camera on mobile

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) {
        resolve(null)
        return
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        alert(`Image is too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
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

    // Compress image
    const compressedBlob = await compressImage(file)
    const compressedFile = new File([compressedBlob], file.name, { type: 'image/jpeg' })

    // Generate unique filename
    const photoId = crypto.randomUUID()
    const fileExtension = compressedFile.name.split('.').pop() || 'jpg'
    const fileName = `${photoId}.${fileExtension}`
    const storagePath = `${alertId}/${fileName}`

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('emergency-photos')
      .upload(storagePath, compressedFile, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (uploadError) {
      console.error('[Photo] Upload error:', uploadError)
      throw uploadError
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from('emergency-photos').getPublicUrl(storagePath)

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
      console.error('[Photo] Database error:', dbError)
      // Try to delete uploaded file if database insert fails
      await supabase.storage.from('emergency-photos').remove([storagePath])
      throw dbError
    }

    console.log('[Photo] ✅ Photo uploaded successfully:', {
      photoId: photoData.id,
      alertId,
      fileSize: compressedFile.size,
    })

    return photoData as EmergencyPhoto
  } catch (error) {
    console.error('[Photo] ❌ Failed to upload photo:', error)
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
    const { data, error } = await supabase
      .from('emergency_photos')
      .select('*')
      .eq('alert_id', alertId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Photo] Error fetching photos:', error)
      return []
    }

    return (data || []) as EmergencyPhoto[]
  } catch (error) {
    console.error('[Photo] Failed to fetch photos:', error)
    return []
  }
}

