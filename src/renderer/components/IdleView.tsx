import { useTranscription } from '../hooks/useTranscription'

// SF Symbol: mic.fill
const MicIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
)

// SF Symbol: gearshape.fill
const GearIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.09 7.09 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.49.49 0 00.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
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

interface IdleViewProps {
  onStart: () => void
  onOpenSettings: () => void
  isLoading: boolean
}

export function IdleView({ onStart, onOpenSettings, isLoading }: IdleViewProps) {
  const { isModelReady, isDownloading, downloadProgress, downloadModel } = useTranscription()

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="mb-8">
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
          <MicIcon className="w-8 h-8 text-gray-400" />
        </div>
      </div>

      <h2 className="text-lg font-medium text-white mb-2">Ready to Record</h2>
      <p className="text-sm text-gray-400 text-center mb-6">
        Click to start capturing your voice feedback
      </p>

      {!isModelReady && !isDownloading && (
        <div className="mb-4 p-3 bg-yellow-900/30 rounded border border-yellow-700/50">
          <p className="text-xs text-yellow-400 text-center mb-2">
            Whisper model not downloaded
          </p>
          <button
            onClick={downloadModel}
            aria-label="Download Whisper model, approximately 140 megabytes"
            className="w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white text-sm btn-macos transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-gray-900"
          >
            Download Model (~140MB)
          </button>
          <p className="text-xs text-gray-500 text-center mt-2">
            Also requires: brew install whisper-cpp
          </p>
        </div>
      )}

      {isDownloading && (
        <div className="mb-4 w-full" role="status" aria-live="polite">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Downloading model...</span>
            <span aria-hidden="true">{downloadProgress}%</span>
          </div>
          <div
            className="w-full h-2 bg-white/10 rounded-full overflow-hidden"
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
        className="w-full px-6 py-3 btn-macos btn-macos-danger disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-gray-900"
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
          </>
        )}
      </button>

      <button
        onClick={onOpenSettings}
        aria-label="Open settings"
        className="mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 rounded px-2 py-1"
      >
        <GearIcon className="w-4 h-4" />
        Settings
      </button>
    </div>
  )
}
