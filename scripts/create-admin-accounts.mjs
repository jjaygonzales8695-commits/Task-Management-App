#!/usr/bin/env node
/**
 * scripts/create-admin-accounts.mjs
 *
 * One-time (or re-runnable) provisioning script for admin accounts.
 *
 * WHY THIS IS A SEPARATE SCRIPT, NOT APP CODE:
 * Creating a Supabase Auth user with a specific password (rather than letting
 * someone pick their own via self-registration) requires the Supabase
 * *service role* key, which has full admin rights and bypasses Row Level
 * Security entirely. That key must NEVER be shipped to a browser / put in
 * VITE_* env vars / committed to git — anyone who gets it can read and
 * modify every row in your database. So this script runs locally, once,
 * from a developer's machine or a secure CI job — never inside the app.
 *
 * SETUP:
 *   1. In Supabase: Project → Settings → API → "service_role" secret key.
 *   2. Create a local, git-ignored file `.env.scripts` (NOT .env.local) with:
 *        SUPABASE_URL=https://your-project-ref.supabase.co
 *        SUPABASE_SERVICE_ROLE_KEY=eyJ...            (service_role, not anon)
 *   3. npm install (this uses the same @supabase/supabase-js already in the
 *      project's dependencies).
 *   4. Run:  node scripts/create-admin-accounts.mjs
 *
 * WHAT IT DOES:
 *   - For each account below that doesn't already exist (matched by email),
 *     creates a real Supabase Auth user with a freshly generated, strong
 *     random password (email pre-confirmed, so no confirmation email is
 *     required to sign in immediately), then inserts the matching profile
 *     row into public.users (no password stored there — see the auth
 *     migration SQL file).
 *   - Skips any account whose email already exists in auth.users, so it's
 *     safe to re-run after adding a new entry to ADMIN_ACCOUNTS.
 *   - Prints every newly created account's username/email/password ONCE at
 *     the end. This is the only time the plaintext password exists outside
 *     Supabase's own hashed storage — copy it into a password manager and
 *     then clear your terminal scrollback. This script never writes
 *     passwords to a file.
 *   - Each person should change their password after first login (Profile →
 *     Security → Change Password in the app).
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── Load .env.scripts (kept separate from the app's own .env.local) ───────
function loadEnvScripts() {
  const dir = dirname(fileURLToPath(import.meta.url))
  const path = join(dir, '..', '.env.scripts')
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    // .env.scripts is optional if these are already set some other way (CI secrets, etc.)
  }
}
loadEnvScripts()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Create a file named .env.scripts in the project root (see the comment at\n' +
    'the top of this script) with both values, then run this script again.\n'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── The 9 admin accounts requested, plus the roster shape for public.users ─
// Edit names/designations to match real staff once you know who's filling
// each seat — usernames and emails can be changed later from the Profile
// page (or here, before first run).
const ADMIN_ACCOUNTS = [
  {
    username: 'superadmin', email: 'superadmin@cedo.gov.ph',
    lastName: 'Reyes', firstName: 'Maria', middleName: 'Santos', suffix: '', nickname: 'Mari',
    designation: 'Department Head', position: 'CEDO Department Head',
    natureOfWork: 'Department Administration', mobilePhone: '09171234567',
    division: 'LITM', role: 'super_admin',
  },
  { username: 'litm.admin1', email: 'litm.admin1@cedo.gov.ph', lastName: 'Admin', firstName: 'LITM', middleName: 'One', suffix: '', nickname: 'LITM1', designation: 'Division Head', position: 'LITM Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000001', division: 'LITM', role: 'division_admin' },
  { username: 'litm.admin2', email: 'litm.admin2@cedo.gov.ph', lastName: 'Admin', firstName: 'LITM', middleName: 'Two', suffix: '', nickname: 'LITM2', designation: 'Assistant Division Head', position: 'LITM Assistant Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000002', division: 'LITM', role: 'division_admin' },
  { username: 'sead.admin1', email: 'sead.admin1@cedo.gov.ph', lastName: 'Admin', firstName: 'SEAD', middleName: 'One', suffix: '', nickname: 'SEAD1', designation: 'Division Head', position: 'SEAD Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000003', division: 'SEAD', role: 'division_admin' },
  { username: 'sead.admin2', email: 'sead.admin2@cedo.gov.ph', lastName: 'Admin', firstName: 'SEAD', middleName: 'Two', suffix: '', nickname: 'SEAD2', designation: 'Assistant Division Head', position: 'SEAD Assistant Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000004', division: 'SEAD', role: 'division_admin' },
  { username: 'af.admin1', email: 'af.admin1@cedo.gov.ph', lastName: 'Admin', firstName: 'AF', middleName: 'One', suffix: '', nickname: 'AF1', designation: 'Division Head', position: 'Administrative & Finance Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000005', division: 'AF', role: 'division_admin' },
  { username: 'af.admin2', email: 'af.admin2@cedo.gov.ph', lastName: 'Admin', firstName: 'AF', middleName: 'Two', suffix: '', nickname: 'AF2', designation: 'Assistant Division Head', position: 'Administrative & Finance Assistant Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000006', division: 'AF', role: 'division_admin' },
  { username: 'epdpm.admin1', email: 'epdpm.admin1@cedo.gov.ph', lastName: 'Admin', firstName: 'EPDPM', middleName: 'One', suffix: '', nickname: 'EPDPM1', designation: 'Division Head', position: 'EPDPM Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000007', division: 'EPDPM', role: 'division_admin' },
  { username: 'epdpm.admin2', email: 'epdpm.admin2@cedo.gov.ph', lastName: 'Admin', firstName: 'EPDPM', middleName: 'Two', suffix: '', nickname: 'EPDPM2', designation: 'Assistant Division Head', position: 'EPDPM Assistant Division Head', natureOfWork: 'Division Administration', mobilePhone: '09170000008', division: 'EPDPM', role: 'division_admin' },
]

function generatePassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_='
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

async function findUserByEmail(email) {
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const match = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match
    if (data.users.length < 200) return null
    page++
  }
}

async function profileExists(id) {
  const { data, error } = await supabase.from('users').select('id').eq('id', id).maybeSingle()
  if (error) throw error
  return !!data
}

async function main() {
  const created = []
  const skipped = []

  for (const account of ADMIN_ACCOUNTS) {
    const existingAuthUser = await findUserByEmail(account.email)
    let authUserId = existingAuthUser?.id
    let password = generatePassword()

    if (existingAuthUser) {
      const hasProfile = await profileExists(existingAuthUser.id)
      if (hasProfile) {
        // Fully set up already — nothing to do.
        skipped.push(account.email)
        continue
      }
      // Auth account exists but its profile row is missing (e.g. a previous
      // run failed partway through, like a NOT NULL constraint on a column
      // that's since been dropped). Reset its password so you get a valid,
      // visible one now — the one from whenever it was first created is lost.
      const { error: resetError } = await supabase.auth.admin.updateUserById(existingAuthUser.id, { password })
      if (resetError) {
        console.error(`✗ Found existing Auth user for ${account.email} but couldn't reset its password:`, resetError.message)
        continue
      }
      console.log(`↻ ${account.email} already existed in Auth with no profile row — password reset, profile will be created now.`)
    } else {
      const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true, // pre-confirmed — can sign in immediately, no email step needed
        user_metadata: { username: account.username, role: account.role, division: account.division },
      })
      if (createError || !authUser?.user) {
        console.error(`✗ Failed to create Auth user for ${account.email}:`, createError?.message)
        continue
      }
      authUserId = authUser.user.id
    }

    const { error: profileError } = await supabase.from('users').insert({
      id: authUserId,
      username: account.username,
      last_name: account.lastName,
      first_name: account.firstName,
      middle_name: account.middleName,
      suffix: account.suffix,
      nickname: account.nickname,
      designation: account.designation,
      position: account.position,
      nature_of_work: account.natureOfWork,
      mobile_phone: account.mobilePhone,
      email: account.email,
      is_admin: true,
      division: account.division,
      role: account.role,
      profile_picture: '',
    })
    if (profileError) {
      console.error(`✗ Auth user ready for ${account.email}, but profile row insert failed:`, profileError.message)
      console.error('  Auth user id (for manual insert in Supabase Studio if needed):', authUserId)
      console.error('  This is most likely because public.users still has a NOT NULL `password` column.')
      console.error('  Run supabase_migration_auth_and_admins.sql successfully first, then re-run this script.')
      continue
    }

    created.push({ ...account, password })
  }

  console.log('\n──────────────────────────────────────────────────────────')
  console.log(`Set up ${created.length} account(s) (created fresh or repaired). Skipped ${skipped.length} (already fully set up).`)
  if (skipped.length) console.log('Already existed:', skipped.join(', '))
  console.log('──────────────────────────────────────────────────────────\n')

  if (created.length) {
    console.log('SAVE THESE NOW — this is the only time the passwords are shown.\n')
    console.log('username'.padEnd(14), 'email'.padEnd(28), 'role'.padEnd(16), 'division'.padEnd(10), 'password')
    for (const a of created) {
      console.log(a.username.padEnd(14), a.email.padEnd(28), a.role.padEnd(16), a.division.padEnd(10), a.password)
    }
    console.log('\nCopy these into a password manager, then clear your terminal (e.g. `clear`).')
    console.log('Each person should change their password after first login: Profile → Security → Change Password.\n')
  }
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})
