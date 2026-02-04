import { useState, useEffect } from 'react'
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
  const { state, session, isLoading, start, stop, cancel, reset, copyToClipboard } = useSession()
  const [view, setView] = useState<View>('main')

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

  if (view === 'settings') {
    return (
      <div className="h-screen bg-gray-900 rounded-xl overflow-hidden">
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
            onStop={stop}
            onCancel={cancel}
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
    <div className="h-screen bg-gray-900 rounded-xl overflow-hidden flex flex-col">
      {/* Drag handle */}
      <div className="h-6 bg-gray-800/50 flex items-center justify-center" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="w-10 h-1 bg-gray-600 rounded-full" />
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0">
        {renderMainContent()}
      </div>

      {/* Footer with donate button (only show in idle/complete states) */}
      {(state === 'idle' || state === 'complete') && (
        <div className="py-2 flex justify-center border-t border-gray-800">
          <DonateButton />
        </div>
      )}
    </div>
  )
}

export default App
