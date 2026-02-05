import { useState, useEffect, memo } from 'react'
import { MicIcon, CameraIcon, StopIcon, MacSpinner } from './icons'

interface RecordingViewProps {
  startedAt: number | null
  screenshotCount: number
  onStop: () => void
  onCancel: () => void
  onScreenshot: () => void
  isLoading: boolean
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDurationForAria(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins === 0) {
    return `${secs} seconds`
  }
  return `${mins} minute${mins !== 1 ? 's' : ''} and ${secs} second${secs !== 1 ? 's' : ''}`
}

// Isolated timer component to prevent full RecordingView re-renders every second
interface RecordingTimerProps {
  startedAt: number | null
}

const RecordingTimer = memo(function RecordingTimer({ startedAt }: RecordingTimerProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) return

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [startedAt])

  return (
    <p
      className="text-3xl font-mono text-red-500 dark:text-red-400 mb-2"
      aria-label={`Elapsed time: ${formatDurationForAria(elapsed)}`}
      role="timer"
    >
      <span aria-hidden="true">{formatDuration(elapsed)}</span>
    </p>
  )
})

export function RecordingView({
  startedAt,
  screenshotCount,
  onStop,
  onCancel,
  onScreenshot,
  isLoading
}: RecordingViewProps) {
  return (
    <div className="view-transition flex flex-col items-center justify-center h-full p-6">
      <div className="mb-6 relative" role="status" aria-live="polite" aria-label="Recording in progress">
        <div className="w-20 h-20 rounded-full bg-red-600/90 flex items-center justify-center animate-pulse">
          <MicIcon className="w-10 h-10 text-white" />
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping" aria-hidden="true" />
      </div>

      <h2 className="text-xl font-medium text-theme-primary mb-2">Recording</h2>
      <RecordingTimer startedAt={startedAt} />

      {screenshotCount > 0 && (
        <p className="text-xs text-theme-tertiary mb-4" role="status" aria-live="polite">
          {screenshotCount} screenshot{screenshotCount !== 1 ? 's' : ''} captured
        </p>
      )}

      <p className="text-sm text-theme-tertiary text-center mb-4">
        Speak your feedback clearly.
      </p>

      {/* Screenshot button */}
      <button
        onClick={onScreenshot}
        disabled={isLoading}
        aria-label="Capture screenshot, keyboard shortcut Command Shift S"
        className="mb-4 px-4 py-2 btn-macos btn-macos-secondary disabled:opacity-50 text-sm flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme"
      >
        <CameraIcon className="w-4 h-4" />
        Screenshot
        <span className="text-xs text-theme-muted ml-1" aria-hidden="true">(⌘⇧S)</span>
      </button>

      <div className="flex gap-3 w-full">
        <button
          onClick={onCancel}
          disabled={isLoading}
          aria-label="Cancel recording"
          className="flex-1 px-4 py-3 btn-macos btn-macos-secondary disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme"
        >
          Cancel
        </button>
        <button
          onClick={onStop}
          disabled={isLoading}
          aria-label={isLoading ? 'Stopping recording' : 'Stop recording'}
          aria-busy={isLoading}
          className="flex-1 px-4 py-3 btn-macos btn-macos-danger disabled:opacity-50 text-white font-medium flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme"
        >
          {isLoading ? (
            <>
              <MacSpinner className="text-white" />
              <span className="ml-1">Stopping...</span>
            </>
          ) : (
            <>
              <StopIcon className="w-5 h-5" />
              Stop
            </>
          )}
        </button>
      </div>
    </div>
  )
}
