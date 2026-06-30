/**
 * useGoogleAuth.ts
 * React hook for Google OAuth state with timeout protection.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  initGoogleClient,
  requestAccessToken,
  isSignedIn as checkSignedIn,
  signOut as doSignOut,
} from './googleAuth'

export interface UseGoogleAuthResult {
  isReady: boolean
  isSignedIn: boolean
  signIn: () => Promise<void>
  signOut: () => void
  error: string | null
}

export function useGoogleAuth(): UseGoogleAuthResult {
  const [isReady, setIsReady] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // 10-second timeout — surfaces a useful error instead of spinning forever
    const timeout = setTimeout(() => {
      if (!cancelled && !isReady) {
        setError(
          'Timed out loading Google APIs. Check your internet connection and that ' +
          'VITE_GOOGLE_CLIENT_ID is set in your .env.local file.'
        )
      }
    }, 10_000)

    initGoogleClient()
      .then(() => {
        if (cancelled) return
        clearTimeout(timeout)
        setIsReady(true)
        setIsSignedIn(checkSignedIn())
      })
      .catch((err: unknown) => {
        if (cancelled) return
        clearTimeout(timeout)
        setError(String(err))
      })

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [])

  const signIn = useCallback(async () => {
    try {
      await requestAccessToken()
      setIsSignedIn(true)
      setError(null)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const signOut = useCallback(() => {
    doSignOut()
    setIsSignedIn(false)
  }, [])

  return { isReady, isSignedIn, signIn, signOut, error }
}
