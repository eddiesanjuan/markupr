import { useState, useEffect, useCallback } from 'react'
import type { SessionState, SessionData } from '../types/api'

export function useSession() {
  const [state, setState] = useState<SessionState>('idle')
  const [session, setSession] = useState<SessionData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Get initial state
    window.api.invoke('session:getSession').then((data) => {
      const sessionData = data as SessionData
      setSession(sessionData)
      setState(sessionData.state)
    })

    // Listen for state changes
    const unsubscribe = window.api.on('session:stateChanged', (data: unknown) => {
      const { state: newState, session: newSession } = data as { state: SessionState; session: SessionData }
      setState(newState)
      setSession(newSession)
      setIsLoading(false)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const start = useCallback(async () => {
    setIsLoading(true)
    const result = await window.api.invoke('session:start')
    if (!result) {
      setIsLoading(false)
    }
    return result as boolean
  }, [])

  const stop = useCallback(async () => {
    setIsLoading(true)
    const result = await window.api.invoke('session:stop')
    if (!result) {
      setIsLoading(false)
    }
    return result as boolean
  }, [])

  const cancel = useCallback(async () => {
    await window.api.invoke('session:cancel')
  }, [])

  const reset = useCallback(async () => {
    await window.api.invoke('session:reset')
  }, [])

  const copyToClipboard = useCallback(async (text: string) => {
    await window.api.invoke('clipboard:write', text)
  }, [])

  return {
    state,
    session,
    isLoading,
    start,
    stop,
    cancel,
    reset,
    copyToClipboard
  }
}
