#!/usr/bin/env node
import { addNamedJavaScript } from 'pdfkit'
/**
 * THE BUSINESS WORK (DASHBOARD v14)
 * Minimal Read-Only PostgreSQL TLS Connection Test
 * 
 * Requirements:
 * - Tests secure TLS connection with Supabase PostgreSQL (direct or pooler).
 * - Strictly verifies certificate chain against Supabase Intermediate + Root CAs.
 * - Confirms hostname verification via SNI.
 * - Performs ZERO writes, ZERO schema changes, and ZERO migrations.
 * 
 * Usage:
 *   node database/test_connection.js
 *   node database/test_connection.js "postgresql://user:pass@host:6543/postgres?sslmode=require"
 */

import { testPostgresConnection } from './migrate_data.js'
import dotenv from 'dotenv'

dotenv.config()

const args = process.argv.slice(2)
const caArg = args.find(a => a.startsWith('--ca=') || a.startsWith('--ca-cert='))
const customCaPath = caArg ? caArg.split('=')[1] : null
const databaseUrl = args.find(a => !a.startsWith('--')) || process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('\n✗ Error: No DATABASE_URL provided!')
  console.error('Provide DATABASE_URL in .env, set $env:DATABASE_URL in PowerShell, or pass as an argument:')
  console.error('  node database/test_connection.js "postgresql://postgres:[PASSWORD]@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"\n')
  process.exit(1)
}

testPostgresConnection(databaseUrl, customCaPath)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n✗ CONNECTION TEST FAILED:', err.message)
    process.exit(1)
  })
