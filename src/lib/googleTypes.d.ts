/**
 * googleTypes.d.ts
 * Minimal ambient declarations for the Google API scripts that are
 * loaded dynamically at runtime (gapi and google.accounts.oauth2).
 * These supplement the @types/google.accounts package installed
 * from npm — which covers GIS but not gapi.client.
 */

// ── gapi (Google API Client Library) ──────────────────────

declare namespace gapi {
  function load(
    libraries: string,
    callbackOrConfig:
      | (() => void)
      | { callback: () => void; onerror?: (err: unknown) => void },
  ): void

  namespace client {
    function init(config: {
      apiKey?: string
      clientId?: string
      discoveryDocs?: string[]
      scope?: string
    }): Promise<void>

    function load(urlOrName: string, version?: string): Promise<void>

    function setToken(token: { access_token: string } | null): void

    function getToken(): { access_token: string } | null

    // Sheets v4
    namespace sheets {
      namespace spreadsheets {
        namespace values {
          function get(params: {
            spreadsheetId: string
            range: string
          }): Promise<{ result: { values?: string[][] } }>

          function append(params: {
            spreadsheetId: string
            range: string
            valueInputOption: string
            insertDataOption?: string
            resource: { values: string[][] }
          }): Promise<void>

          function update(params: {
            spreadsheetId: string
            range: string
            valueInputOption: string
            resource: { values: string[][] }
          }): Promise<void>
        }
      }
    }

    // Drive v3
    namespace drive {
      namespace permissions {
        function create(params: {
          fileId: string
          resource: { type: string; role: string }
        }): Promise<void>
      }
    }
  }

  namespace auth2 {
    interface GoogleAuth {
      isSignedIn: { get(): boolean }
      signIn(): Promise<void>
      signOut(): Promise<void>
      currentUser: {
        get(): {
          getAuthResponse(): { access_token: string; expires_in: number }
        }
      }
    }
    function getAuthInstance(): GoogleAuth
  }
}
