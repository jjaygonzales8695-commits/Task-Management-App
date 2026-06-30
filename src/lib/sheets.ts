/**
 * sheets.ts
 * Typed wrapper around Google Sheets v4 REST API using fetch directly.
 * Does NOT rely on gapi.client.sheets discovery — avoids init hangs.
 */

import { getAccessToken } from './googleAuth'

const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SPREADSHEET_ID as string
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

// ── Internal fetch helper ──────────────────────────────────

async function sheetsRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getAccessToken()
  if (!token) throw new Error('Not authenticated. Sign in with Google first.')

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Sheets API error ${res.status}: ${err}`)
  }

  // DELETE returns 204 No Content
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Low-level helpers ──────────────────────────────────────

/** Reads all rows from a sheet (row 0 = headers). */
export async function readSheet(sheetName: string): Promise<string[][]> {
  const data = await sheetsRequest<{ values?: string[][] }>(
    'GET',
    `/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!A:ZZ')}`,
  )
  return data.values ?? []
}

/** Converts raw rows (row 0 = headers) into typed objects. */
export function rowsToObjects<T extends Record<string, unknown>>(rows: string[][]): T[] {
  if (rows.length < 1) return []
  const [headers, ...dataRows] = rows
  return dataRows.map((row) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
    return obj as T
  })
}

/** Appends a single row to the end of a sheet. */
export async function appendRow(
  sheetName: string,
  row: (string | number | boolean)[],
): Promise<void> {
  await sheetsRequest(
    'POST',
    `/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: [row.map(String)] },
  )
}

/** Overwrites a specific 1-based row number. */
export async function updateRow(
  sheetName: string,
  rowNumber: number,
  row: (string | number | boolean)[],
): Promise<void> {
  await sheetsRequest(
    'PUT',
    `/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!A' + rowNumber)}?valueInputOption=RAW`,
    { values: [row.map(String)] },
  )
}

/** Finds the 1-based row number where column A === id. Returns -1 if not found. */
export async function findRowById(sheetName: string, id: string): Promise<number> {
  const rows = await readSheet(sheetName)
  const idx = rows.findIndex((row) => row[0] === id)
  return idx === -1 ? -1 : idx + 1
}

/** Updates the row whose column A matches id. */
export async function updateRowById(
  sheetName: string,
  id: string,
  row: (string | number | boolean)[],
): Promise<void> {
  const rowNumber = await findRowById(sheetName, id)
  if (rowNumber === -1) throw new Error(`Row "${id}" not found in "${sheetName}"`)
  await updateRow(sheetName, rowNumber, row)
}

// ── Typed CRUD helpers ─────────────────────────────────────

export async function getAll<T extends Record<string, unknown>>(
  sheetName: string,
): Promise<T[]> {
  const rows = await readSheet(sheetName)
  return rowsToObjects<T>(rows)
}

export async function getById<T extends Record<string, unknown>>(
  sheetName: string,
  id: string,
): Promise<T | null> {
  const all = await getAll<T>(sheetName)
  return (all.find((r) => (r as { id?: string }).id === id) as T) ?? null
}

/**
 * Inserts a record. Auto-writes the header row if the sheet is empty.
 */
export async function insertRecord<T extends Record<string, unknown>>(
  sheetName: string,
  record: T,
): Promise<void> {
  const headers = Object.keys(record)
  const rows = await readSheet(sheetName)

  if (rows.length === 0) {
    // Write header row first via update (append won't create row 1 cleanly)
    await sheetsRequest(
      'PUT',
      `/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!A1')}?valueInputOption=RAW`,
      { values: [headers] },
    )
  }

  await appendRow(sheetName, headers.map((h) => String(record[h] ?? '')))
}

/** Updates an existing record matched by its id field. */
export async function updateRecord<T extends Record<string, unknown>>(
  sheetName: string,
  record: T & { id: string },
): Promise<void> {
  const rows = await readSheet(sheetName)
  if (rows.length === 0) throw new Error(`Sheet "${sheetName}" is empty`)
  const headers = rows[0]
  const row = headers.map((h) => String((record as Record<string, unknown>)[h] ?? ''))
  await updateRowById(sheetName, record.id, row)
}

// ── Sheet name constants ───────────────────────────────────

export const SHEETS = {
  USERS: 'Users',
  MONTHLY_TASKS: 'MonthlyTasks',
  WEEKLY_TASKS: 'WeeklyTasks',
  DELIVERABLES: 'Deliverables',
  DAILY_TASKS: 'DailyTasks',
  SUBMISSIONS: 'Submissions',
  LEAVE_REQUESTS: 'LeaveRequests',
  NOTIFICATIONS: 'Notifications',
} as const
