import crypto from 'crypto'
import { query } from '../_lib/db.js'

/**
 * Service for Google Sheets API v4 Two-Way CRM Synchronization.
 * Uses native Node.js crypto RS256 JWT assertion for Google Service Accounts.
 * Zero external npm dependencies.
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
    const res = await query('SELECT * FROM public.google_sheet_config ORDER BY id LIMIT 1')
    if (res.rows.length > 0) {
      return res.rows[0]
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
    const logRes = await query(`
      SELECT * FROM public.google_sheet_sync_logs
      ORDER BY started_at DESC
      LIMIT 10
    `)
    const statsRes = await query(`
      SELECT
        COUNT(*) FILTER (WHERE is_deleted = false)::int as active_leads,
        COUNT(*) FILTER (WHERE is_deleted = true)::int as trashed_leads,
        COUNT(*) FILTER (WHERE google_sheet_synced_at IS NOT NULL AND is_deleted = false)::int as synced_leads
      FROM public.clients
    `)

    return {
      config: {
        spreadsheet_id: config.spreadsheet_id ? `${config.spreadsheet_id.substring(0, 8)}...` : 'Not Configured',
        sheet_name: config.sheet_name || 'Leads',
        last_sync_at: config.last_sync_at,
        last_sync_status: config.last_sync_status,
        last_error: config.last_error,
        configured: Boolean(config.spreadsheet_id && (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_JSON))
      },
      stats: statsRes.rows[0] || { active_leads: 0, trashed_leads: 0, synced_leads: 0 },
      recent_logs: logRes.rows
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
      await query(`
        INSERT INTO public.google_sheet_sync_logs (sync_type, status, error_message, triggered_by, completed_at)
        VALUES ('bidirectional', 'config_required', 'GOOGLE_SHEETS_SPREADSHEET_ID is not configured.', $1, now())
      `, [userId])
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
      await query(`
        INSERT INTO public.google_sheet_sync_logs (sync_type, status, error_message, triggered_by, completed_at)
        VALUES ('bidirectional', 'failed', $1, $2, now())
      `, [err.message, userId])
      return {
        success: false,
        error: 'AUTH_FAILED',
        message: `Google authentication failed: ${err.message}`
      }
    }

    if (!token) {
      // Record config required and return clear status
      await query(`
        INSERT INTO public.google_sheet_sync_logs (sync_type, status, error_message, triggered_by, completed_at)
        VALUES ('bidirectional', 'config_required', 'Google Service Account credentials missing in environment variables.', $1, now())
      `, [userId])
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

    // Set of IDs existing in sheet
    const sheetTbwIds = new Set()
    const sheetPhones = new Set()

    // Process Inbound Rows from Google Sheets
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

      if (tbwId) sheetTbwIds.add(tbwId)
      if (rawPhone) sheetPhones.add(rawPhone)

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
        // Respect soft-deletion tombstone
        if (client.is_deleted) {
          continue
        }

        // Update existing record
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
        // Insert new lead from Google Sheets
        const insertRes = await query(`
          INSERT INTO public.clients (
            name, whatsapp_phone, email, business_name, requirement, budget,
            lifecycle_status, google_sheet_row_id, google_sheet_synced_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
          RETURNING id, _tbw_id
        `, [name || 'New Lead', rawPhone, email, business, req, budget, status, String(r + 1)])
        imported++

        // Write back generated _tbw_id to sheet cell if column exists
        if (idxTbwId !== -1 && insertRes.rows[0]?._tbw_id) {
          const colLetter = String.fromCharCode(65 + idxTbwId)
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!${colLetter}${r + 1}?valueInputOption=USER_ENTERED`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: [[insertRes.rows[0]._tbw_id]] })
          })
        }
      }
    }

    // Step 2: Push unsynced active DB leads to Google Sheet
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
        exported = unsyncedDbLeads.rows.length
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
    `, [imported, exported, updated, JSON.stringify({ sheet_rows: rows.length }), userId])

    return {
      success: true,
      imported,
      updated,
      exported,
      total_sheet_rows: rows.length,
      synced_at: new Date().toISOString()
    }
  }
}

export const googleSheetsService = new GoogleSheetsService()
