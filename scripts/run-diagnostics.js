#!/usr/bin/env node

/**
 * Run diagnostics from command line
 * Checks environment variables, file structure, and can test API endpoints
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Running Connection Diagnostics...\n');
console.log('='.repeat(60));

const results = {
  passed: [],
  warnings: [],
  errors: [],
};

// Test 1: Environment Variables
console.log('\n1. Checking Environment Variables...');
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  
  const optionalVars = [
    'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'VAPID_EMAIL',
  ];
  
  let allRequired = true;
  requiredVars.forEach(varName => {
    if (envContent.includes(`${varName}=`)) {
      results.passed.push(`✓ ${varName} is set`);
      console.log(`  ✓ ${varName} is set`);
    } else {
      allRequired = false;
      results.errors.push(`✗ ${varName} is missing`);
      console.log(`  ✗ ${varName} is MISSING`);
    }
  });
  
  optionalVars.forEach(varName => {
    if (envContent.includes(`${varName}=`)) {
      results.passed.push(`✓ ${varName} is set`);
      console.log(`  ✓ ${varName} is set`);
    } else {
      results.warnings.push(`⚠ ${varName} is not set (optional but needed for push)`);
      console.log(`  ⚠ ${varName} is not set (optional for push notifications)`);
    }
  });
} else {
  results.errors.push('✗ .env.local file not found');
  console.log('  ✗ .env.local file NOT FOUND');
}

// Test 2: Check if migration files exist
console.log('\n2. Checking Migration Files...');
const migrationsPath = path.join(process.cwd(), 'migrations');
if (fs.existsSync(migrationsPath)) {
  const migrationFiles = fs.readdirSync(migrationsPath);
  
  const requiredMigrations = [
    'fix-emergency-alerts-comprehensive.sql',
    'add-push-subscriptions.sql',
  ];
  
  requiredMigrations.forEach(migration => {
    if (migrationFiles.includes(migration)) {
      results.passed.push(`✓ Migration file exists: ${migration}`);
      console.log(`  ✓ ${migration} exists`);
    } else {
      results.warnings.push(`⚠ Migration file missing: ${migration}`);
      console.log(`  ⚠ ${migration} is missing`);
    }
  });
} else {
  results.errors.push('✗ migrations directory not found');
  console.log('  ✗ migrations directory NOT FOUND');
}

// Test 3: Check if diagnostic files exist
console.log('\n3. Checking Diagnostic Files...');
const diagnosticFiles = [
  'lib/diagnostics/connection-test.ts',
  'components/ConnectionDiagnostics.tsx',
  'app/diagnostics/page.tsx',
];

diagnosticFiles.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    results.passed.push(`✓ Diagnostic file exists: ${file}`);
    console.log(`  ✓ ${file} exists`);
  } else {
    results.errors.push(`✗ Diagnostic file missing: ${file}`);
    console.log(`  ✗ ${file} is MISSING`);
  }
});

// Test 4: Check package.json for required dependencies
console.log('\n4. Checking Dependencies...');
const packageJsonPath = path.join(process.cwd(), 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  const requiredDeps = [
    '@supabase/supabase-js',
    '@supabase/ssr',
    'web-push',
  ];
  
  requiredDeps.forEach(dep => {
    if (deps[dep]) {
      results.passed.push(`✓ Dependency installed: ${dep}`);
      console.log(`  ✓ ${dep} is installed (${deps[dep]})`);
    } else {
      results.errors.push(`✗ Dependency missing: ${dep}`);
      console.log(`  ✗ ${dep} is MISSING - run: npm install ${dep}`);
    }
  });
}

// Test 5: Check if node_modules exists
console.log('\n5. Checking Installation...');
const nodeModulesPath = path.join(process.cwd(), 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  results.passed.push('✓ node_modules directory exists');
  console.log('  ✓ node_modules exists (dependencies installed)');
} else {
  results.errors.push('✗ node_modules not found - run: npm install');
  console.log('  ✗ node_modules NOT FOUND - run: npm install');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n📊 Diagnostic Summary:\n');
console.log(`  ✅ Passed: ${results.passed.length}`);
console.log(`  ⚠️  Warnings: ${results.warnings.length}`);
console.log(`  ❌ Errors: ${results.errors.length}`);

if (results.errors.length > 0) {
  console.log('\n❌ Errors that need to be fixed:');
  results.errors.forEach(error => console.log(`  ${error}`));
}

if (results.warnings.length > 0) {
  console.log('\n⚠️  Warnings (may cause issues):');
  results.warnings.forEach(warning => console.log(`  ${warning}`));
}

console.log('\n' + '='.repeat(60));
console.log('\n📋 Next Steps:');
console.log('1. Fix any errors shown above');
console.log('2. Run the database migration in Supabase SQL Editor:');
console.log('   migrations/fix-emergency-alerts-comprehensive.sql');
console.log('3. Start the dev server: npm run dev');
console.log('4. Navigate to http://localhost:3000/diagnostics');
console.log('5. The web diagnostics will test live connections');
console.log('\n');


