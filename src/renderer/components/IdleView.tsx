import { useState } from 'react'
import { MicIcon, GearIcon, MacSpinner } from './icons'
import type { TranscriptionConfig } from '../types/api'

interface TranscriptionState {
  isModelReady: boolean
  isDownloading: boolean
  downloadProgress: number
  config: TranscriptionConfig | null
  downloadModel: () => Promise<boolean>
  updateConfig: (newConfig: Partial<TranscriptionConfig>) => Promise<void>
}

interface IdleViewProps {
  onStart: () => void
  onOpenSettings: () => void
  isLoading: boolean
  transcription: TranscriptionState
}

export function IdleView({ onStart, onOpenSettings, isLoading, transcription }: IdleViewProps) {
  const { isModelReady, isDownloading, downloadProgress, downloadModel } = transcription
  const [isStartingDownload, setIsStartingDownload] = useState(false)

  const handleDownload = async () => {
    setIsStartingDownload(true)
    try {
      await downloadModel()
    } finally {
      setIsStartingDownload(false)
    }
  }

  return (
    <div className="view-transition flex flex-col items-center justify-center h-full p-6">
      <div className="mb-8">
        <div className="w-16 h-16 rounded-full bg-theme-secondary flex items-center justify-center">
          <MicIcon className="w-8 h-8 text-theme-tertiary" />
        </div>
      </div>

      <h2 className="text-lg font-medium text-theme-primary mb-2">Ready to Record</h2>
      <p className="text-sm text-theme-tertiary text-center mb-6">
        Click to start capturing your voice feedback
      </p>

      {!isModelReady && !isDownloading && (
        <div className="mb-4 p-3 bg-blue-500/10 dark:bg-blue-900/30 rounded border border-blue-300/50 dark:border-blue-700/50">
          <p className="text-xs text-blue-600 dark:text-blue-400 text-center mb-2">
            Download Whisper model to get started
          </p>
          <button
            onClick={handleDownload}
            disabled={isStartingDownload}
            aria-label="Download Whisper model, approximately 140 megabytes"
            className="w-full px-3 py-1.5 btn-macos btn-macos-primary text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme flex items-center justify-center gap-2"
          >
            {isStartingDownload ? (
              <>
                <MacSpinner className="text-white" />
                <span>Starting...</span>
              </>
            ) : (
              'Download Model (~140MB)'
            )}
          </button>
          <p className="text-xs text-theme-muted text-center mt-2">
            Also requires: brew install whisper-cpp
          </p>
        </div>
      )}

      {isDownloading && (
        <div className="mb-4 w-full" role="status" aria-live="polite">
          <div className="flex justify-between text-xs text-theme-tertiary mb-1">
            <span>Downloading model...</span>
            <span aria-hidden="true">{downloadProgress}%</span>
          </div>
          <div
            className="w-full h-2 bg-theme-secondary rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={downloadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Download progress: ${downloadProgress} percent`}
          >
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        </div>
      )}

      <button
        onClick={onStart}
        disabled={isLoading || isDownloading}
        aria-label={isLoading ? 'Starting recording' : 'Start recording'}
        aria-busy={isLoading}
        className="w-full px-6 py-3 btn-macos btn-macos-danger disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme"
      >
        {isLoading ? (
          <>
            <MacSpinner className="text-white" />
            <span className="ml-1">Starting...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="6" />
            </svg>
            Start Recording
            <span className="text-xs text-red-200 ml-1" aria-hidden="true">(⌘⇧F)</span>
          </>
        )}
      </button>

      <button
        onClick={onOpenSettings}
        aria-label="Open settings"
        className="mt-4 text-sm text-theme-muted hover:text-theme-secondary transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ring-offset-theme rounded px-2 py-1"
      >
        <GearIcon className="w-4 h-4" />
        Settings
      </button>
    </div>
  )
}
