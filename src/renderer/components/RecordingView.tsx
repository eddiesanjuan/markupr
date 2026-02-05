import { useState, useEffect } from 'react'

// SF Symbol: mic.fill
const MicIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
)

// SF Symbol: camera.fill
const CameraIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 15.2c1.77 0 3.2-1.43 3.2-3.2 0-1.77-1.43-3.2-3.2-3.2-1.77 0-3.2 1.43-3.2 3.2 0 1.77 1.43 3.2 3.2 3.2z"/>
    <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
  </svg>
)

// SF Symbol: stop.fill
const StopIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
)

// macOS-style spinner component
const MacSpinner = ({ className }: { className?: string }) => (
  <div className={`macos-spinner ${className || ''}`} aria-hidden="true">
    {[...Array(12)].map((_, i) => (
      <div key={i} className="macos-spinner-segment" />
    ))}
  </div>
)

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

export function RecordingView({
  startedAt,
  screenshotCount,
  onStop,
  onCancel,
  onScreenshot,
  isLoading
}: RecordingViewProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) return

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [startedAt])

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="mb-6 relative" role="status" aria-live="polite" aria-label="Recording in progress">
        <div className="w-20 h-20 rounded-full bg-red-600/90 flex items-center justify-center animate-pulse">
          <MicIcon className="w-10 h-10 text-white" />
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping" aria-hidden="true" />
      </div>

      <h2 className="text-xl font-medium text-white mb-2">Recording</h2>
      <p
        className="text-3xl font-mono text-red-400 mb-2"
        aria-label={`Elapsed time: ${formatDurationForAria(elapsed)}`}
        role="timer"
      >
        <span aria-hidden="true">{formatDuration(elapsed)}</span>
      </p>

      {screenshotCount > 0 && (
        <p className="text-xs text-gray-400 mb-4" role="status" aria-live="polite">
          {screenshotCount} screenshot{screenshotCount !== 1 ? 's' : ''} captured
        </p>
      )}

      <p className="text-sm text-gray-400 text-center mb-4">
        Speak your feedback clearly.
      </p>

      {/* Screenshot button */}
      <button
        onClick={onScreenshot}
        disabled={isLoading}
        aria-label="Capture screenshot, keyboard shortcut Command Shift S"
        className="mb-4 px-4 py-2 btn-macos btn-macos-secondary disabled:opacity-50 text-white text-sm flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
      >
        <CameraIcon className="w-4 h-4" />
        Screenshot
        <span className="text-xs text-gray-500 ml-1" aria-hidden="true">(Cmd+Shift+S)</span>
      </button>

      <div className="flex gap-3 w-full">
        <button
          onClick={onCancel}
          disabled={isLoading}
          aria-label="Cancel recording"
          className="flex-1 px-4 py-3 btn-macos btn-macos-secondary disabled:opacity-50 text-white focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-900"
        >
          Cancel
        </button>
        <button
          onClick={onStop}
          disabled={isLoading}
          aria-label={isLoading ? 'Stopping recording' : 'Stop recording'}
          aria-busy={isLoading}
          className="flex-1 px-4 py-3 btn-macos btn-macos-danger disabled:opacity-50 text-white font-medium flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-gray-900"
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
