import { useState, useEffect } from 'react'

interface RecordingViewProps {
  startedAt: number | null
  onStop: () => void
  onCancel: () => void
  isLoading: boolean
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function RecordingView({ startedAt, onStop, onCancel, isLoading }: RecordingViewProps) {
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
      <div className="mb-6 relative">
        <div className="w-20 h-20 rounded-full bg-red-600 flex items-center justify-center animate-pulse">
          <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping" />
      </div>

      <h2 className="text-xl font-medium text-white mb-2">Recording</h2>
      <p className="text-3xl font-mono text-red-400 mb-6">{formatDuration(elapsed)}</p>

      <p className="text-sm text-gray-400 text-center mb-6">
        Speak your feedback clearly. Click stop when done.
      </p>

      <div className="flex gap-3 w-full">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onStop}
          disabled={isLoading}
          className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Stopping...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </>
          )}
        </button>
      </div>
    </div>
  )
}
