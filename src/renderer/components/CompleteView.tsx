import { useState, useEffect } from 'react'
import type { SessionData } from '../types/api'

interface CompleteViewProps {
  session: SessionData
  onReset: () => void
  onCopy: (text: string) => void
}

export function CompleteView({ session, onReset, onCopy }: CompleteViewProps) {
  const [copied, setCopied] = useState(false)
  const [showAutoCopied, setShowAutoCopied] = useState(true)

  // Show auto-copied notification briefly on mount
  useEffect(() => {
    if (session.reportPath) {
      const timer = setTimeout(() => setShowAutoCopied(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [session.reportPath])

  const handleCopyPath = () => {
    if (session.reportPath) {
      onCopy(session.reportPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const duration = session.startedAt && session.stoppedAt
    ? Math.floor((session.stoppedAt - session.startedAt) / 1000)
    : 0

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${String(secs).padStart(2, '0')}`
  }

  // Format path for display (shorten home dir to ~)
  const displayPath = session.reportPath?.replace(/^\/Users\/[^/]+/, '~') || ''

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-medium text-white">
            {showAutoCopied && session.reportPath ? 'Report saved! Path copied' : 'Complete!'}
          </h2>
          <p className="text-xs text-gray-400">
            {formatDuration(duration)} recorded
            {session.screenshots.length > 0 && (
              <span> &bull; {session.screenshots.length} screenshot{session.screenshots.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
      </div>

      {session.reportPath && (
        <div className="mb-3 px-2 py-1.5 bg-gray-800/50 rounded text-xs text-gray-400 font-mono truncate">
          {displayPath}
        </div>
      )}

      <div className="flex-1 min-h-0 mb-3">
        <div className="h-full bg-gray-800 rounded-lg p-3 overflow-y-auto">
          <p className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
            {session.markdownOutput || session.transcript || 'No transcription available'}
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          New Recording
        </button>
        <button
          onClick={handleCopyPath}
          disabled={!session.reportPath}
          className={`flex-1 px-4 py-2.5 ${
            copied ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed'
          } text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2`}
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy Path
            </>
          )}
        </button>
      </div>
    </div>
  )
}
