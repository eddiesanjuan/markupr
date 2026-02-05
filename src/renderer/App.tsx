import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from './hooks/useSession'
import { useTranscription } from './hooks/useTranscription'
import { IdleView } from './components/IdleView'
import { RecordingView } from './components/RecordingView'
import { ProcessingView } from './components/ProcessingView'
import { CompleteView } from './components/CompleteView'
import { ErrorView } from './components/ErrorView'
import { SettingsView } from './components/SettingsView'
import { DonateButton } from './components/DonateButton'

type View = 'main' | 'settings'

interface RecoverySession {
  id: string
  state: string
  startedAt: number | null
  audioPath: string | null
}

function App() {
  const { state, session, isLoading, start, stop, cancel, reset, copyToClipboard, captureScreenshot } = useSession()
  const transcription = useTranscription()
  const [view, setView] = useState<View>('main')
  const [screenshotCount, setScreenshotCount] = useState(0)
  const [recoverySession, setRecoverySession] = useState<RecoverySession | null>(null)
  const [showRecoveryModal, setShowRecoveryModal] = useState(false)

  // Use ref to access state in IPC callbacks without re-subscribing on state changes
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Keyboard navigation handler
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Escape key: close popover (except during recording to prevent accidental cancellation)
    if (event.key === 'Escape') {
      if (state === 'recording') {
        // During recording, Escape does nothing to prevent accidental cancellation
        return
      }
      if (view === 'settings') {
        setView('main')
        event.preventDefault()
      }
      // In main view, Escape could close the popover via IPC if needed
    }
  }, [state, view])

  // Register keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  // Listen for session recovery events
  useEffect(() => {
    const unsubRecovery = window.api.on('recovery:found', (data: unknown) => {
      const saved = data as RecoverySession
      setRecoverySession(saved)
      setShowRecoveryModal(true)
    })
    return () => unsubRecovery()
  }, [])

  const handleRecover = async () => {
    if (recoverySession) {
      await window.api.invoke('recovery:recover', recoverySession)
    }
    setShowRecoveryModal(false)
    setRecoverySession(null)
  }

  const handleDiscardRecovery = async () => {
    await window.api.invoke('recovery:discard')
    setShowRecoveryModal(false)
    setRecoverySession(null)
  }

  // Listen for tray menu events
  // Use stateRef to avoid re-subscribing listeners on every state change
  useEffect(() => {
    const unsubStartRecording = window.api.on('tray:startRecording', () => {
      if (stateRef.current === 'idle') {
        start()
      }
    })

    const unsubOpenSettings = window.api.on('tray:openSettings', () => {
      setView('settings')
    })

    return () => {
      unsubStartRecording()
      unsubOpenSettings()
    }
  }, [start])

  // Listen for screenshot events
  useEffect(() => {
    const unsubScreenshot = window.api.on('screenshot:captured', (data: unknown) => {
      const { index } = data as { index: number }
      setScreenshotCount(index)
    })

    return () => {
      unsubScreenshot()
    }
  }, [])

  // Reset screenshot count when starting a new recording
  useEffect(() => {
    if (state === 'idle') {
      setScreenshotCount(0)
    }
  }, [state])

  // Update screenshot count from session data
  useEffect(() => {
    if (session?.screenshots) {
      setScreenshotCount(session.screenshots.length)
    }
  }, [session?.screenshots])

  const handleScreenshot = async () => {
    const result = await captureScreenshot()
    if (!result.success) {
      console.error('Screenshot failed:', result.error)
    }
  }

  if (view === 'settings') {
    return (
      <div
        className="h-screen bg-popover rounded-xl overflow-hidden relative"
        role="dialog"
        aria-label="Settings"
      >
        <div className="popover-arrow" aria-hidden="true" />
        <SettingsView onBack={() => setView('main')} transcription={transcription} />
      </div>
    )
  }

  const renderMainContent = () => {
    switch (state) {
      case 'idle':
        return (
          <IdleView
            onStart={start}
            onOpenSettings={() => setView('settings')}
            isLoading={isLoading}
            transcription={transcription}
          />
        )
      case 'starting':
        return (
          <IdleView
            onStart={start}
            onOpenSettings={() => setView('settings')}
            isLoading={true}
            transcription={transcription}
          />
        )
      case 'recording':
        return (
          <RecordingView
            startedAt={session?.startedAt || null}
            screenshotCount={screenshotCount}
            onStop={stop}
            onCancel={cancel}
            onScreenshot={handleScreenshot}
            isLoading={isLoading}
          />
        )
      case 'stopping':
      case 'processing':
        return <ProcessingView />
      case 'complete':
        return session ? (
          <CompleteView
            session={session}
            onReset={reset}
            onCopy={copyToClipboard}
          />
        ) : null
      case 'error':
        return <ErrorView error={session?.error || null} onReset={reset} onOpenSettings={() => setView('settings')} />
      default:
        return null
    }
  }

  return (
    <div
      className="h-screen bg-popover rounded-xl overflow-hidden flex flex-col relative"
      role="main"
      aria-label="FeedbackFlow"
    >
      {/* Popover arrow */}
      <div className="popover-arrow" aria-hidden="true" />

      {/* Main content */}
      <main className="flex-1 min-h-0 pt-2">
        {renderMainContent()}
      </main>

      {/* Footer with donate button (only show in idle/complete states) */}
      {(state === 'idle' || state === 'complete') && (
        <footer className="py-2 flex justify-center border-t border-theme">
          <DonateButton />
        </footer>
      )}

      {/* Recovery modal */}
      {showRecoveryModal && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50 rounded-xl" role="dialog" aria-label="Session recovery">
          <div className="bg-popover rounded-lg p-5 mx-4 shadow-xl border border-theme">
            <h3 className="text-base font-medium text-theme-primary mb-2">Recover Session?</h3>
            <p className="text-sm text-theme-tertiary mb-4">
              An interrupted recording session was found. Would you like to recover and process it?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDiscardRecovery}
                className="flex-1 px-3 py-2 btn-macos btn-macos-secondary text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme"
              >
                Discard
              </button>
              <button
                onClick={handleRecover}
                className="flex-1 px-3 py-2 btn-macos btn-macos-primary text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme"
              >
                Recover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
