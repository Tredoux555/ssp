/**
 * Script to clear all files from Supabase Storage bucket
 * Run with: npx tsx scripts/clear-supabase-storage.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables')
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function clearStorageBucket(bucketName: string) {
  console.log(`🗑️  Clearing bucket: ${bucketName}`)

  try {
    // List all files in the bucket
    const { data: files, error: listError } = await supabase.storage
      .from(bucketName)
      .list('', {
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      })

    if (listError) {
      console.error('❌ Error listing files:', listError)
      return
    }

    if (!files || files.length === 0) {
      console.log('✅ Bucket is already empty')
      return
    }

    console.log(`📋 Found ${files.length} files/folders`)

    // Delete all files
    const pathsToDelete: string[] = []

    // Recursively collect all file paths
    async function collectPaths(path: string = '') {
      const { data: items, error } = await supabase.storage
        .from(bucketName)
        .list(path, {
          limit: 1000,
          offset: 0,
        })

      if (error) {
        console.error(`❌ Error listing ${path}:`, error)
        return
      }

      if (!items) return

      for (const item of items) {
        const fullPath = path ? `${path}/${item.name}` : item.name

        if (item.id === null) {
          // It's a folder, recurse
          await collectPaths(fullPath)
        } else {
          // It's a file
          pathsToDelete.push(fullPath)
        }
      }
    }

    // Collect all paths recursively
    await collectPaths()

    if (pathsToDelete.length === 0) {
      console.log('✅ No files to delete')
      return
    }

    console.log(`🗑️  Deleting ${pathsToDelete.length} files...`)

    // Delete in batches of 100
    const batchSize = 100
    for (let i = 0; i < pathsToDelete.length; i += batchSize) {
      const batch = pathsToDelete.slice(i, i + batchSize)
      const { error: deleteError } = await supabase.storage
        .from(bucketName)
        .remove(batch)

      if (deleteError) {
        console.error(`❌ Error deleting batch ${i / batchSize + 1}:`, deleteError)
      } else {
        console.log(`✅ Deleted batch ${i / batchSize + 1} (${batch.length} files)`)
      }
    }

    console.log(`✅ Successfully cleared ${pathsToDelete.length} files from ${bucketName}`)
  } catch (error: any) {
    console.error('❌ Unexpected error:', error)
  }
}

// Main execution
async function main() {
  const bucketName = 'emergency-photos'
  
  console.log('🚀 Starting storage cleanup...')
  console.log(`📦 Bucket: ${bucketName}`)
  console.log('')

  await clearStorageBucket(bucketName)

  console.log('')
  console.log('✨ Done!')
}

main().catch(console.error)


