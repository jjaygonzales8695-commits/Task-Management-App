/**
 * drive.ts
 * Uploads files to Google Drive and returns a public URL.
 * Uses fetch directly — no gapi.client.drive dependency.
 */

import { getAccessToken } from './googleAuth'

const FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID as string | undefined

const UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webContentLink,webViewLink'

const PERMISSIONS_URL = (fileId: string) =>
  `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`

export interface DriveFile {
  id: string
  webContentLink: string
  webViewLink: string
  publicUrl?: string
}

// ── Public API ─────────────────────────────────────────────

export async function uploadImageToDrive(
  base64DataUrl: string,
  filename: string,
): Promise<DriveFile> {
  const blob = dataUrlToBlob(base64DataUrl)
  const mimeType = blob.type

  const metadata: Record<string, unknown> = { name: filename, mimeType }
  if (FOLDER_ID) metadata.parents = [FOLDER_ID]

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', blob)

  const token = getAccessToken()
  if (!token) throw new Error('Not authenticated.')

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`)

  const file = (await res.json()) as DriveFile
  await makePublic(file.id)
  file.publicUrl = `https://drive.google.com/uc?export=view&id=${file.id}`
  return file
}

export async function uploadFileToDrive(file: File, filename?: string): Promise<DriveFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try { resolve(await uploadImageToDrive(e.target?.result as string, filename ?? file.name)) }
      catch (err) { reject(err) }
    }
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

export async function deleteFromDrive(fileId: string): Promise<void> {
  const token = getAccessToken()
  if (!token) throw new Error('Not authenticated.')
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ── Helpers ────────────────────────────────────────────────

async function makePublic(fileId: string): Promise<void> {
  const token = getAccessToken()
  if (!token) return
  await fetch(PERMISSIONS_URL(fileId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bytes = atob(data)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], { type: mime })
}
