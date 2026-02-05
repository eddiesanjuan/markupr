import { useState, useEffect, useCallback } from 'react'
import type { SessionState, SessionData, ScreenshotResult } from '../types/api'
import { isIPCResponse } from '../utils/ipc'

/**
 * Valid session states for type guard validation
 */
const VALID_SESSION_STATES: SessionState[] = [
  'idle', 'starting', 'recording', 'stopping', 'processing', 'complete', 'error'
]

/**
 * Type guard to validate SessionState
 */
function isSessionState(value: unknown): value is SessionState {
  return typeof value === 'string' && VALID_SESSION_STATES.includes(value as SessionState)
}

/**
 * Type guard to validate SessionData structure
 */
function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    isSessionState(obj.state) &&
    (obj.startedAt === null || typeof obj.startedAt === 'number') &&
    (obj.stoppedAt === null || typeof obj.stoppedAt === 'number') &&
    (obj.audioPath === null || typeof obj.audioPath === 'string') &&
    (obj.transcript === null || typeof obj.transcript === 'string') &&
    Array.isArray(obj.screenshots) &&
    (obj.markdownOutput === null || typeof obj.markdownOutput === 'string') &&
    (obj.reportPath === null || typeof obj.reportPath === 'string') &&
    (obj.error === null || typeof obj.error === 'string') &&
    typeof obj.stateEnteredAt === 'number'
  )
}

/**
 * Type guard to validate state change event data
 */
function isStateChangeEvent(value: unknown): value is { state: SessionState; session: SessionData } {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return isSessionState(obj.state) && isSessionData(obj.session)
}

/**
 * Type guard to validate ScreenshotResult
 */
function isScreenshotResult(value: unknown): value is ScreenshotResult {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.success === 'boolean' &&
    (obj.error === undefined || typeof obj.error === 'string')
  )
}

export function useSession() {
  const [state, setState] = useState<SessionState>('idle')
  const [session, setSession] = useState<SessionData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Get initial state with validation
    window.api.invoke('session:getSession').then((response) => {
      if (!isIPCResponse<SessionData>(response)) {
        console.error('Invalid IPC response structure for session:getSession')
        return
      }
      if (!response.success || !response.data) {
        console.error('Failed to get session:', response.error)
        return
      }
      if (!isSessionData(response.data)) {
        console.error('Invalid session data structure:', response.data)
        return
      }
      setSession(response.data)
      setState(response.data.state)
    })

    // Listen for state changes with validation
    const unsubscribe = window.api.on('session:stateChanged', (data: unknown) => {
      if (!isStateChangeEvent(data)) {
        console.error('Invalid state change event structure:', data)
        return
      }
      setState(data.state)
      setSession(data.session)
      setIsLoading(false)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const start = useCallback(async () => {
    setIsLoading(true)
    const response = await window.api.invoke('session:start')
    if (!isIPCResponse<boolean>(response)) {
      console.error('Invalid IPC response for session:start')
      setIsLoading(false)
      return false
    }
    if (!response.success) {
      console.error('Session start failed:', response.error)
      setIsLoading(false)
      return false
    }
    // Keep loading true - state change event will reset it
    if (!response.data) {
      setIsLoading(false)
    }
    return response.data ?? false
  }, [])

  const stop = useCallback(async () => {
    setIsLoading(true)
    const response = await window.api.invoke('session:stop')
    if (!isIPCResponse<boolean>(response)) {
      console.error('Invalid IPC response for session:stop')
      setIsLoading(false)
      return false
    }
    if (!response.success) {
      console.error('Session stop failed:', response.error)
      setIsLoading(false)
      return false
    }
    // Keep loading true - state change event will reset it
    if (!response.data) {
      setIsLoading(false)
    }
    return response.data ?? false
  }, [])

  const cancel = useCallback(async () => {
    const response = await window.api.invoke('session:cancel')
    if (!isIPCResponse(response)) {
      console.error('Invalid IPC response for session:cancel')
      return
    }
    if (!response.success) {
      console.error('Session cancel failed:', response.error)
    }
  }, [])

  const reset = useCallback(async () => {
    const response = await window.api.invoke('session:reset')
    if (!isIPCResponse(response)) {
      console.error('Invalid IPC response for session:reset')
      return
    }
    if (!response.success) {
      console.error('Session reset failed:', response.error)
    }
  }, [])

  const copyToClipboard = useCallback(async (text: string) => {
    const response = await window.api.invoke('clipboard:write', text)
    if (!isIPCResponse(response)) {
      console.error('Invalid IPC response for clipboard:write')
      return
    }
    if (!response.success) {
      console.error('Clipboard write failed:', response.error)
    }
  }, [])

  const captureScreenshot = useCallback(async (): Promise<ScreenshotResult> => {
    const response = await window.api.invoke('screenshot:capture')
    // screenshot:capture returns ScreenshotResult directly (already structured)
    if (!isScreenshotResult(response)) {
      console.error('Invalid response for screenshot:capture')
      return { success: false, error: 'Invalid response structure' }
    }
    return response
  }, [])

  return {
    state,
    session,
    isLoading,
    start,
    stop,
    cancel,
    reset,
    copyToClipboard,
    captureScreenshot
  }
}
