/**
 * googleAuth.ts
 * Handles Google OAuth 2.0 via GIS (Google Identity Services) token model.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
].join(' ')

let _accessToken: string | null = null
let _tokenExpiry: number | null = null
let _tokenClient: google.accounts.oauth2.TokenClient | null = null
let _initDone = false

// ── Initialise ─────────────────────────────────────────────

export async function initGoogleClient(): Promise<void> {
  if (_initDone) return
  _initDone = true

  // 1. Load both scripts in parallel
  await Promise.all([
    loadScript('https://apis.google.com/js/api.js'),
    loadScript('https://accounts.google.com/gsi/client'),
  ])

  // 2. Load gapi.client (no discovery docs yet — we call REST directly)
  await new Promise<void>((resolve, reject) => {
    gapi.load('client', { callback: resolve, onerror: reject })
  })

  // 3. Initialise gapi.client without discovery docs to avoid hangs.
  //    We'll call the Sheets/Drive REST endpoints directly with fetch instead.
  await gapi.client.init({})

  // 4. Set up GIS token client
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {}, // overridden per-call in requestAccessToken()
  })
}

// ── Auth API ───────────────────────────────────────────────

export function requestAccessToken(silent = false): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!_tokenClient) {
      reject(new Error('Google client not initialised.'))
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((_tokenClient as any).callback) = (response: google.accounts.oauth2.TokenResponse) => {
      if ((response as unknown as { error?: string }).error) {
        reject(new Error((response as unknown as { error: string }).error))
        return
      }
      _accessToken = response.access_token
      _tokenExpiry = Date.now() + ((response.expires_in as unknown as number) ?? 3600) * 1000
      gapi.client.setToken({ access_token: _accessToken })
      resolve()
    }
    // 'none' = attempt silent re-auth using the existing Google session,
    // with no popup. Falls back to '' (interactive) when called manually.
    _tokenClient.requestAccessToken({ prompt: silent ? 'none' : '' })
  })
}

export function getAccessToken(): string | null {
  if (!_accessToken || !_tokenExpiry) return null
  if (Date.now() > _tokenExpiry - 60_000) {
    _accessToken = null
    _tokenExpiry = null
    return null
  }
  return _accessToken
}

export function isSignedIn(): boolean {
  return getAccessToken() !== null
}

export function signOut(): void {
  if (_accessToken) google.accounts.oauth2.revoke(_accessToken, () => {})
  _accessToken = null
  _tokenExpiry = null
  gapi.client.setToken(null)
}

// ── Script loader ──────────────────────────────────────────

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load: ${src}`))
    document.head.appendChild(s)
  })
}
