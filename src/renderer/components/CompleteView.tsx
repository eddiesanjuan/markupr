import { useState } from 'react'
import type { SessionData } from '../types/api'

interface CompleteViewProps {
  session: SessionData
  onReset: () => void
  onCopy: (text: string) => void
}

export function CompleteView({ session, onReset, onCopy }: CompleteViewProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (session.transcript) {
      onCopy(session.transcript)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const duration = session.startedAt && session.stoppedAt
    ? Math.floor((session.stoppedAt - session.startedAt) / 1000)
    : 0

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-medium text-white">Complete!</h2>
          <p className="text-xs text-gray-400">
            {duration}s recorded
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 mb-4">
        <div className="h-full bg-gray-800 rounded-lg p-3 overflow-y-auto">
          <p className="text-sm text-gray-300 whitespace-pre-wrap">
            {session.transcript || 'No transcription available'}
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
          onClick={handleCopy}
          className={`flex-1 px-4 py-2.5 ${
            copied ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'
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
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  )
}
