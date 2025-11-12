/**
 * Script to clear all files from Vercel Blob Storage
 * 
 * Prerequisites:
 * 1. Install: npm install @vercel/blob
 * 2. Set environment variable: BLOB_READ_WRITE_TOKEN (from Vercel dashboard)
 * 
 * Run with: npx tsx scripts/clear-vercel-blob.ts
 */

import { list, del } from '@vercel/blob'

const token = process.env.BLOB_READ_WRITE_TOKEN

if (!token) {
  console.error('❌ Missing BLOB_READ_WRITE_TOKEN environment variable')
  console.error('Get it from: Vercel Dashboard → Your Project → Settings → Environment Variables')
  process.exit(1)
}

async function clearAllBlobs() {
  console.log('🗑️  Clearing all Vercel Blob files...')
  console.log('')

  let totalDeleted = 0
  let cursor: string | undefined

  try {
    do {
      // List blobs (100 at a time)
      const listResult = await list({ 
        cursor, 
        limit: 100,
        token 
      })

      if (listResult.blobs.length === 0) {
        if (totalDeleted === 0) {
          console.log('✅ No blobs found - storage is already empty')
        }
        break
      }

      // Extract URLs for deletion
      const urls = listResult.blobs.map(blob => blob.url)
      
      console.log(`📋 Found ${urls.length} blobs (total deleted so far: ${totalDeleted})`)

      // Delete this batch
      try {
        await del(urls, { token })
        totalDeleted += urls.length
        console.log(`✅ Deleted ${urls.length} blobs`)
      } catch (deleteError: any) {
        console.error(`❌ Error deleting batch:`, deleteError.message)
        // Continue with next batch
      }

      // Get cursor for next page
      cursor = listResult.cursor
    } while (cursor)

    console.log('')
    console.log(`✨ Successfully deleted ${totalDeleted} blobs`)
  } catch (error: any) {
    console.error('❌ Error clearing blobs:', error.message)
    process.exit(1)
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting Vercel Blob cleanup...')
  console.log('')

  await clearAllBlobs()

  console.log('')
  console.log('✨ Done!')
}

main().catch(console.error)


