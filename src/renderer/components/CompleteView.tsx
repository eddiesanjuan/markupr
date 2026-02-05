import { useState, useEffect } from 'react'
import type { SessionData } from '../types/api'

// SF Symbol: checkmark.circle.fill (static version for button)
const CheckmarkCircleIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
  </svg>
)

// Animated checkmark using stroke-dashoffset animation
const AnimatedCheckmark = ({ className }: { className?: string }) => (
  <svg
    className={`checkmark-animated ${className || ''}`}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5 13l4 4L19 7"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// SF Symbol: doc.on.doc
const CopyIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
  </svg>
)

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
    <div className="view-transition flex flex-col h-full p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-green-600/90 flex items-center justify-center flex-shrink-0">
          <AnimatedCheckmark className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-medium text-theme-primary">
            {showAutoCopied && session.reportPath ? 'Report saved! Path copied' : 'Complete!'}
          </h2>
          <p className="text-xs text-theme-tertiary">
            {formatDuration(duration)} recorded
            {session.screenshots.length > 0 && (
              <span> &bull; {session.screenshots.length} screenshot{session.screenshots.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
      </div>

      {session.reportPath && (
        <div className="mb-3 px-2 py-1.5 bg-theme-tertiary rounded text-xs text-theme-tertiary font-mono truncate" aria-label={`Report saved to ${session.reportPath}`}>
          {displayPath}
        </div>
      )}

      <div className="flex-1 min-h-0 mb-3">
        <div
          className="min-h-[100px] max-h-[200px] bg-theme-tertiary rounded p-3 overflow-y-auto"
          aria-label="Transcription result"
          tabIndex={0}
          role="region"
        >
          <p className="text-sm text-theme-secondary whitespace-pre-wrap font-mono">
            {session.markdownOutput || session.transcript || 'No transcription available'}
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onReset}
          aria-label="Start a new recording"
          className="flex-1 px-4 py-2.5 btn-macos btn-macos-secondary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme"
        >
          New Recording
        </button>
        <button
          onClick={handleCopyPath}
          disabled={!session.reportPath}
          aria-label={copied ? 'Path copied to clipboard' : 'Copy report path to clipboard'}
          className={`flex-1 px-4 py-2.5 btn-macos ${
            copied ? 'bg-green-600' : 'btn-macos-primary disabled:opacity-50 disabled:cursor-not-allowed'
          } text-white font-medium flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme`}
        >
          {copied ? (
            <>
              <CheckmarkCircleIcon className="w-4 h-4" />
              Copied!
            </>
          ) : (
            <>
              <CopyIcon className="w-4 h-4" />
              Copy Path
            </>
          )}
        </button>
      </div>
    </div>
  )
}
