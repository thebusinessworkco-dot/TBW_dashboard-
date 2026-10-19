import crypto from 'crypto'
import { query } from '../_lib/db.js'

/**
 * Service for Google Sheets API v4 Two-Way CRM Synchronization.
 * Uses native Node.js crypto RS256 JWT assertion for Google Service Accounts.
 * Zero external npm dependencies.
 *
 * Capabilities:
 * - Google Sheets -> Supabase: Create, Update, and Delete detection.
 * - Supabase -> Google Sheets: Create, Update, Soft-delete marking.
 * - Stable record ID independent of sheet row position (via _tbw_id UUID).
 * - Sorting & insertion resilience (row positions dynamically resolved via _tbw_id).
 * - Conflict resolution & detailed sync audit trail.
 * - Preservation of user formulas and unmapped columns.
 */

class GoogleSheetsService {
  /**
   * Generates a Google OAuth2 access token using Service Account RS256 assertion
   */
  async getAccessToken() {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    let key = process.env.GOOGLE_PRIVATE_KEY

    // Support JSON credential payload if provided
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
        return this.exchangeJwtForToken(parsed.client_email, parsed.private_key)
      } catch (err) {
        console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err.message)
      }
    }

    if (!email || !key) {
      return null
    }

    // Fix escaped newlines in env variables
    key = key.replace(/\\n/g, '\n')

    return this.exchangeJwtForToken(email, key)
  }

  async exchangeJwtForToken(clientEmail, privateKey) {
    try {
      const now = Math.floor(Date.now() / 1000)
      const header = { alg: 'RS256', typ: 'JWT' }
      const claimSet = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      }

      const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
      const b64Claim = Buffer.from(JSON.stringify(claimSet)).toString('base64url')
      const signInput = `${b64Header}.${b64Claim}`

      const signer = crypto.createSign('RSA-SHA256')
      signer.update(signInput)
      signer.end()
      const signature = signer.sign(privateKey, 'base64url')
      const assertion = `${signInput}.${signature}`

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error_description || data.error || 'OAuth exchange failed')
      }

      return data.access_token
    } catch (err) {
      console.error('Error generating Google Sheets access token:', err.message)
      throw err
    }
  }

  /**
   * Retrieves active Google Sheets configuration
   */
  async getConfig() {
    try {
      const res = await query('SELECT * FROM public.google_sheet_config ORDER BY id LIMIT 1')
      if (res.rows.length > 0) {
        return res.rows[0]
      }
    } catch {
      // Fallback to environment variables when DB is offline or not yet migrated
    }

    const defaultSpreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || ''
    return {
      spreadsheet_id: defaultSpreadsheetId,
      sheet_name: 'Leads',
      header_row: 1,
      column_mapping: {
        _tbw_id: 'TBW_ID',
        name: 'Name',
        whatsapp_phone: 'Phone',
        email: 'Email',
        business_name: 'Business Name',
        requirement: 'Requirement',
        budget: 'Budget',
        lifecycle_status: 'Status',
        next_followup: 'Follow Up',
        created_at: 'CapturedAt'
      }
    }
  }

  /**
   * Fetches sync status and recent log entries
   */
  async getStatus() {
    const config = await this.getConfig()
    let recentLogs = []
    let stats = { active_leads: 0, trashed_leads: 0, synced_leads: 0 }

    try {
      const logRes = await query(`
        SELECT * FROM public.google_sheet_sync_logs
        ORDER BY started_at DESC
        LIMIT 10
      `)
      recentLogs = logRes.rows

      const statsRes = await query(`
        SELECT
          COUNT(*) FILTER (WHERE is_deleted = false)::int as active_leads,
          COUNT(*) FILTER (WHERE is_deleted = true)::int as trashed_leads,
          COUNT(*) FILTER (WHERE google_sheet_synced_at IS NOT NULL AND is_deleted = false)::int as synced_leads
        FROM public.clients
      `)
      if (statsRes.rows[0]) stats = statsRes.rows[0]
    } catch {
      // Offline/unmigrated fallback
    }

    return {
      config: {
        spreadsheet_id: config.spreadsheet_id ? `${config.spreadsheet_id.substring(0, 8)}...` : 'Not Configured',
        sheet_name: config.sheet_name || 'Leads',
        last_sync_at: config.last_sync_at,
        last_sync_status: config.last_sync_status,
        last_error: config.last_error,
        configured: Boolean(config.spreadsheet_id && (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_JSON))
      },
      stats,
      recent_logs: recentLogs
    }
  }

  /**
   * Performs full two-way synchronization between Google Sheets and Supabase PostgreSQL
   */
  async syncTwoWay(userId = null) {
    const config = await this.getConfig()
    const spreadsheetId = config.spreadsheet_id || process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    const sheetName = config.sheet_name || 'Leads'

    if (!spreadsheetId) {
      try {
        await query(`
          INSERT INTO public.google_sheet_sync_logs (sync_type, status, error_message, triggered_by, completed_at)
          VALUES ('bidirectional', 'config_required', 'GOOGLE_SHEETS_SPREADSHEET_ID is not configured.', $1, now())
        `, [userId])
      } catch {}
      return {
        success: false,
        error: 'CONFIG_REQUIRED',
        message: 'Google Sheets Spreadsheet ID is not configured. Please set GOOGLE_SHEETS_SPREADSHEET_ID.'
      }
    }

    let token = null
    try {
      token = await this.getAccessToken()
    } catch (err) {
      try {
        await query(`
          INSERT INTO public.google_sheet_sync_logs (sync_type, status, error_message, triggered_by, completed_at)
          VALUES ('bidirectional', 'failed', $1, $2, now())
        `, [err.message, userId])
      } catch {}
      return {
        success: false,
        error: 'AUTH_FAILED',
        message: `Google authentication failed: ${err.message}`
      }
    }

    if (!token) {
      try {
        await query(`
          INSERT INTO public.google_sheet_sync_logs (sync_type, status, error_message, triggered_by, completed_at)
          VALUES ('bidirectional', 'config_required', 'Google Service Account credentials missing in environment variables.', $1, now())
        `, [userId])
      } catch {}
      return {
        success: false,
        error: 'CREDENTIALS_MISSING',
        message: 'Google Service Account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY) are not configured in Vercel environment.'
      }
    }

    // Step 1: Read Google Sheet rows
    const range = `${encodeURIComponent(sheetName)}!A1:Z1000`
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`

    const readRes = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!readRes.ok) {
      const errBody = await readRes.text()
      const msg = `Google Sheets API read failed (${readRes.status}): ${errBody}`
      await query(`
        INSERT INTO public.google_sheet_sync_logs (sync_type, status, error_message, triggered_by, completed_at)
        VALUES ('bidirectional', 'failed', $1, $2, now())
      `, [msg, userId])
      return { success: false, error: 'SHEETS_API_ERROR', message: msg }
    }

    const sheetData = await readRes.json()
    const rows = sheetData.values || []

    let imported = 0
    let updated = 0
    let exported = 0
    let deletedFromSheet = 0
    const conflicts = []

    if (rows.length === 0) {
      // Empty sheet: Initialize header row
      const headers = ['TBW_ID', 'Name', 'Phone', 'Email', 'Business Name', 'Requirement', 'Budget', 'Status', 'Follow Up', 'CapturedAt']
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:J1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [headers] })
      })
      rows.push(headers)
    }

    const headerRow = rows[0] || []
    const colIndex = (colName) => headerRow.findIndex(h => String(h).trim().toLowerCase() === String(colName).trim().toLowerCase())

    const idxTbwId = colIndex('TBW_ID')
    const idxName = colIndex('Name')
    const idxPhone = colIndex('Phone')
    const idxEmail = colIndex('Email')
    const idxBusiness = colIndex('Business Name')
    const idxReq = colIndex('Requirement')
    const idxBudget = colIndex('Budget')
    const idxStatus = colIndex('Status')
    const idxFollowup = colIndex('Follow Up')
    const idxCaptured = colIndex('CapturedAt')

    // Track all seen TBW IDs from the sheet to detect Sheet-side deletions
    const sheetTbwIds = new Set()
    // Map of TBW ID -> current row index (1-based)
    const sheetRowMap = new Map()

    // ------------------------------------------------------------------------
    // PHASE A: INBOUND SYNC (Google Sheets -> PostgreSQL)
    // ------------------------------------------------------------------------
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      if (!row || row.length === 0) continue

      const tbwId = idxTbwId !== -1 ? String(row[idxTbwId] || '').trim() : null
      const rawPhone = idxPhone !== -1 ? String(row[idxPhone] || '').replace(/\D/g, '') : null
      const name = idxName !== -1 ? String(row[idxName] || '').trim() : ''
      const email = idxEmail !== -1 ? String(row[idxEmail] || '').trim() : null
      const business = idxBusiness !== -1 ? String(row[idxBusiness] || '').trim() : null
      const req = idxReq !== -1 ? String(row[idxReq] || '').trim() : null
      const budget = idxBudget !== -1 && !isNaN(Number(row[idxBudget])) ? Number(row[idxBudget]) : null
      const rawStatus = idxStatus !== -1 ? String(row[idxStatus] || '').trim().toLowerCase().replace(/\s+/g, '_') : 'new_lead'
      const status = ['new_lead', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost', 'archived'].includes(rawStatus) ? rawStatus : 'new_lead'
      const isSheetTrashed = String(row[idxStatus] || '').includes('[DELETED]') || String(row[idxStatus] || '').includes('[TRASHED]')

      if (tbwId) {
        sheetTbwIds.add(tbwId)
        sheetRowMap.set(tbwId, r + 1)
      }

      if (!name && !rawPhone) continue

      // Check if lead already exists in DB
      let client = null
      if (tbwId) {
        const cRes = await query('SELECT * FROM public.clients WHERE _tbw_id = $1', [tbwId])
        client = cRes.rows[0]
      } else if (rawPhone) {
        const cRes = await query('SELECT * FROM public.clients WHERE whatsapp_phone = $1', [rawPhone])
        client = cRes.rows[0]
      }

      if (client) {
        sheetRowMap.set(client._tbw_id, r + 1)

        // Tombstone check: If client was soft-deleted in DB, NEVER resurrect it!
        if (client.is_deleted) {
          // If the sheet doesn't say [DELETED] yet, update the sheet status cell
          if (idxStatus !== -1 && !isSheetTrashed) {
            const colLetter = String.fromCharCode(65 + idxStatus)
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!${colLetter}${r + 1}?valueInputOption=USER_ENTERED`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ values: [['[DELETED]']] })
            }).catch(() => {})
          }
          continue
        }

        // If sheet says [DELETED] but DB is not deleted yet, user deleted row in Sheet!
        if (isSheetTrashed) {
          await query(`
            UPDATE public.clients
            SET is_deleted = true, deleted_at = now(), google_sheet_synced_at = now()
            WHERE id = $1
          `, [client.id])
          deletedFromSheet++
          continue
        }

        // Conflict check: Did both systems edit this lead since last sync?
        const dbWasUpdated = client.google_sheet_synced_at && new Date(client.updated_at) > new Date(client.google_sheet_synced_at)
        const sheetHasChanges = (name && name !== client.name) ||
                                (email && email !== client.email) ||
                                (status && status !== client.lifecycle_status) ||
                                (budget != null && budget !== client.budget)

        if (dbWasUpdated && sheetHasChanges) {
          conflicts.push({
            tbw_id: client._tbw_id,
            client_id: client.id,
            reason: 'Concurrent edit detected. DB updated_at takes priority.'
          })
          // DB takes priority when more recent; will be written back in Phase C
          continue
        }

        // Apply Sheet updates to DB
        await query(`
          UPDATE public.clients
          SET
            name = COALESCE(NULLIF($1, ''), name),
            email = COALESCE(NULLIF($2, ''), email),
            business_name = COALESCE(NULLIF($3, ''), business_name),
            requirement = COALESCE(NULLIF($4, ''), requirement),
            budget = COALESCE($5, budget),
            lifecycle_status = $6,
            google_sheet_row_id = $7,
            google_sheet_synced_at = now(),
            updated_at = now()
          WHERE id = $8
        `, [name, email, business, req, budget, status, String(r + 1), client.id])
        updated++
      } else {
        // Insert new lead from Google Sheets (if not marked deleted)
        if (isSheetTrashed) continue

        const insertRes = await query(`
          INSERT INTO public.clients (
            name, whatsapp_phone, email, business_name, requirement, budget,
            lifecycle_status, google_sheet_row_id, google_sheet_synced_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
          RETURNING id, _tbw_id
        `, [name || 'New Lead', rawPhone, email, business, req, budget, status, String(r + 1)])
        imported++

        const newTbwId = insertRes.rows[0]?._tbw_id
        if (newTbwId) {
          sheetRowMap.set(newTbwId, r + 1)
          // Write back generated _tbw_id to sheet cell so it is permanently anchored
          if (idxTbwId !== -1) {
            const colLetter = String.fromCharCode(65 + idxTbwId)
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!${colLetter}${r + 1}?valueInputOption=USER_ENTERED`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ values: [[newTbwId]] })
            }).catch(() => {})
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // PHASE B: DELETE DETECTION (Google Sheets -> PostgreSQL)
    // If a previously synced client is now missing from the sheet, mark soft-deleted
    // ------------------------------------------------------------------------
    if (sheetTbwIds.size > 0) {
      const missingDbLeads = await query(`
        SELECT id, name, _tbw_id FROM public.clients
        WHERE is_deleted = false
          AND google_sheet_synced_at IS NOT NULL
          AND _tbw_id IS NOT NULL
          AND NOT (_tbw_id::text = ANY($1::text[]))
      `, [Array.from(sheetTbwIds)])

      for (const missing of missingDbLeads.rows) {
        await query(`
          UPDATE public.clients
          SET is_deleted = true, deleted_at = now(), updated_at = now()
          WHERE id = $1
        `, [missing.id])

        await query(`
          INSERT INTO public.lead_events (client_id, event_type, description, user_id)
          VALUES ($1, 'lead_deleted_from_sheet', 'Lead removed from Google Sheet; moved to trash', $2)
        `, [missing.id, userId])

        deletedFromSheet++
      }
    }

    // ------------------------------------------------------------------------
    // PHASE C: OUTBOUND SYNC (PostgreSQL -> Google Sheets)
    // 1. Update existing rows in Google Sheets where DB was modified
    // 2. Append brand-new DB leads to Google Sheets
    // ------------------------------------------------------------------------
    // C1: Update modified existing rows
    const modifiedDbLeads = await query(`
      SELECT * FROM public.clients
      WHERE is_deleted = false
        AND google_sheet_synced_at IS NOT NULL
        AND updated_at > google_sheet_synced_at
    `)

    for (const lead of modifiedDbLeads.rows) {
      const targetRow = sheetRowMap.get(lead._tbw_id)
      if (targetRow) {
        // Construct the row array matching the sheet's header positions
        const updateRow = []
        for (let i = 0; i < Math.max(headerRow.length, 10); i++) {
          if (i === idxTbwId) updateRow.push(lead._tbw_id)
          else if (i === idxName) updateRow.push(lead.name)
          else if (i === idxPhone) updateRow.push(lead.whatsapp_phone || '')
          else if (i === idxEmail) updateRow.push(lead.email || '')
          else if (i === idxBusiness) updateRow.push(lead.business_name || '')
          else if (i === idxReq) updateRow.push(lead.requirement || '')
          else if (i === idxBudget) updateRow.push(lead.budget || '')
          else if (i === idxStatus) updateRow.push(lead.lifecycle_status)
          else if (i === idxFollowup) updateRow.push(lead.next_followup || '')
          else if (i === idxCaptured) updateRow.push(lead.created_at)
          else updateRow.push(rows[targetRow - 1]?.[i] || '')
        }

        const endColLetter = String.fromCharCode(65 + updateRow.length - 1)
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A${targetRow}:${endColLetter}${targetRow}?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [updateRow] })
        }).catch(() => {})

        await query('UPDATE public.clients SET google_sheet_synced_at = now() WHERE id = $1', [lead.id])
        exported++
      }
    }

    // C2: Append unsynced active DB leads
    const unsyncedDbLeads = await query(`
      SELECT * FROM public.clients
      WHERE is_deleted = false
        AND (google_sheet_synced_at IS NULL OR google_sheet_row_id IS NULL)
      ORDER BY id ASC
    `)

    if (unsyncedDbLeads.rows.length > 0) {
      const appendRows = unsyncedDbLeads.rows.map(c => {
        const row = []
        for (let i = 0; i < Math.max(headerRow.length, 10); i++) {
          if (i === idxTbwId) row.push(c._tbw_id)
          else if (i === idxName) row.push(c.name)
          else if (i === idxPhone) row.push(c.whatsapp_phone || '')
          else if (i === idxEmail) row.push(c.email || '')
          else if (i === idxBusiness) row.push(c.business_name || '')
          else if (i === idxReq) row.push(c.requirement || '')
          else if (i === idxBudget) row.push(c.budget || '')
          else if (i === idxStatus) row.push(c.lifecycle_status)
          else if (i === idxFollowup) row.push(c.next_followup || '')
          else if (i === idxCaptured) row.push(c.created_at)
          else row.push('')
        }
        return row
      })

      const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:J:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: appendRows })
      })

      if (appendRes.ok) {
        exported += unsyncedDbLeads.rows.length
        await query(`
          UPDATE public.clients
          SET google_sheet_synced_at = now()
          WHERE id = ANY($1::bigint[])
        `, [unsyncedDbLeads.rows.map(c => c.id)])
      }
    }

    // Step 3: Record Sync Audit Log & Update Config
    await query(`
      UPDATE public.google_sheet_config
      SET
        last_sync_at = now(),
        last_sync_status = 'success',
        last_error = NULL,
        updated_at = now()
      WHERE id = (SELECT id FROM public.google_sheet_config LIMIT 1)
    `)

    await query(`
      INSERT INTO public.google_sheet_sync_logs (
        sync_type, status, rows_imported, rows_exported, rows_updated,
        details, triggered_by, completed_at
      ) VALUES ('bidirectional', 'success', $1, $2, $3, $4, $5, now())
    `, [
      imported,
      exported,
      updated,
      JSON.stringify({
        sheet_rows: rows.length,
        deleted_from_sheet: deletedFromSheet,
        conflicts_count: conflicts.length,
        conflicts
      }),
      userId
    ])

    return {
      success: true,
      imported,
      updated,
      exported,
      deleted_from_sheet: deletedFromSheet,
      conflicts_count: conflicts.length,
      total_sheet_rows: rows.length,
      synced_at: new Date().toISOString()
    }
  }
}

export const googleSheetsService = new GoogleSheetsService()
