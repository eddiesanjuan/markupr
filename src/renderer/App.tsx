import { useState, useEffect, useCallback } from 'react'
import { useSession } from './hooks/useSession'
import { IdleView } from './components/IdleView'
import { RecordingView } from './components/RecordingView'
import { ProcessingView } from './components/ProcessingView'
import { CompleteView } from './components/CompleteView'
import { ErrorView } from './components/ErrorView'
import { SettingsView } from './components/SettingsView'
import { DonateButton } from './components/DonateButton'

type View = 'main' | 'settings'

function App() {
  const { state, session, isLoading, start, stop, cancel, reset, copyToClipboard, captureScreenshot } = useSession()
  const [view, setView] = useState<View>('main')
  const [screenshotCount, setScreenshotCount] = useState(0)

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

  // Listen for tray menu events
  useEffect(() => {
    const unsubStartRecording = window.api.on('tray:startRecording', () => {
      if (state === 'idle') {
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
  }, [state, start])

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
        className="h-screen rounded-xl overflow-hidden relative"
        style={{ backgroundColor: 'rgba(30, 30, 30, 0.85)' }}
        role="dialog"
        aria-label="Settings"
      >
        <div className="popover-arrow" aria-hidden="true" />
        <SettingsView onBack={() => setView('main')} />
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
          />
        )
      case 'starting':
        return (
          <IdleView
            onStart={start}
            onOpenSettings={() => setView('settings')}
            isLoading={true}
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
        return <ErrorView error={session?.error || null} onReset={reset} />
      default:
        return null
    }
  }

  return (
    <div
      className="h-screen rounded-xl overflow-hidden flex flex-col relative"
      style={{ backgroundColor: 'rgba(30, 30, 30, 0.85)' }}
      role="application"
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
        <footer className="py-2 flex justify-center border-t border-white/10">
          <DonateButton />
        </footer>
      )}
    </div>
  )
}

export default App
