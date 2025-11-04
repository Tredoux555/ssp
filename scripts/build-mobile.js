#!/usr/bin/env node

/**
 * Build script for Capacitor mobile apps
 * Temporarily excludes API routes since they can't be statically exported
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const apiDir = path.join(__dirname, '..', 'app', 'api');
const apiBackupDir = path.join(__dirname, '..', 'api.backup');

// Dynamic routes that will be handled client-side in Capacitor
const dynamicRoutes = [
  path.join(__dirname, '..', 'app', 'alert', '[id]'),
  path.join(__dirname, '..', 'app', 'contacts', 'invite', '[token]'),
  path.join(__dirname, '..', 'app', 'emergency', 'active', '[id]'),
];
const dynamicRoutesBackup = dynamicRoutes.map(dir => dir + '.backup');

console.log('📱 Building for Capacitor mobile app...\n');

try {
  // Step 1: Backup API routes (they won't work in static export anyway)
  if (fs.existsSync(apiDir)) {
    console.log('📦 Backing up API routes...');
    if (fs.existsSync(apiBackupDir)) {
      fs.rmSync(apiBackupDir, { recursive: true, force: true });
    }
    fs.renameSync(apiDir, apiBackupDir);
    console.log('✅ API routes backed up\n');
  }

  // Step 1.5: Backup dynamic routes (handled client-side in Capacitor)
  console.log('📦 Backing up dynamic routes...');
  dynamicRoutes.forEach((route, index) => {
    if (fs.existsSync(route)) {
      const backup = dynamicRoutesBackup[index];
      if (fs.existsSync(backup)) {
        fs.rmSync(backup, { recursive: true, force: true });
      }
      fs.renameSync(route, backup);
    }
  });
  console.log('✅ Dynamic routes backed up\n');

  // Step 2: Build Next.js app with static export
  console.log('🔨 Building Next.js app...');
  process.env.CAPACITOR_BUILD = 'true';
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build complete\n');

  // Step 3: Restore dynamic routes
  console.log('📦 Restoring dynamic routes...');
  dynamicRoutes.forEach((route, index) => {
    const backup = dynamicRoutesBackup[index];
    if (fs.existsSync(backup)) {
      if (fs.existsSync(route)) {
        fs.rmSync(route, { recursive: true, force: true });
      }
      fs.renameSync(backup, route);
    }
  });
  console.log('✅ Dynamic routes restored\n');

  // Step 4: Restore API routes
  if (fs.existsSync(apiBackupDir)) {
    console.log('📦 Restoring API routes...');
    if (fs.existsSync(apiDir)) {
      fs.rmSync(apiDir, { recursive: true, force: true });
    }
    fs.renameSync(apiBackupDir, apiDir);
    console.log('✅ API routes restored\n');
  }

  console.log('🎉 Mobile build complete! Run "npm run sync:ios" or "npm run sync:android" to sync with native projects.');
} catch (error) {
  // Restore dynamic routes on error
  dynamicRoutes.forEach((route, index) => {
    const backup = dynamicRoutesBackup[index];
    if (fs.existsSync(backup) && !fs.existsSync(route)) {
      fs.renameSync(backup, route);
    }
  });
  
  // Restore API routes on error
  if (fs.existsSync(apiBackupDir) && !fs.existsSync(apiDir)) {
    console.log('\n⚠️  Build failed. Restoring routes...');
    fs.renameSync(apiBackupDir, apiDir);
  }
  console.error('\n❌ Build failed:', error.message);
  process.exit(1);
}

