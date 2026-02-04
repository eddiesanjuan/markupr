import { useTranscription } from '../hooks/useTranscription'

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
        <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </div>
      </div>

      <h2 className="text-lg font-medium text-white mb-2">Ready to Record</h2>
      <p className="text-sm text-gray-400 text-center mb-6">
        Click to start capturing your voice feedback
      </p>

      {!isModelReady && !isDownloading && (
        <div className="mb-4 p-3 bg-yellow-900/30 rounded-lg border border-yellow-700/50">
          <p className="text-xs text-yellow-400 text-center mb-2">
            Whisper model not downloaded
          </p>
          <button
            onClick={downloadModel}
            className="w-full px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded transition-colors"
          >
            Download Model (~140MB)
          </button>
        </div>
      )}

      {isDownloading && (
        <div className="mb-4 w-full">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Downloading model...</span>
            <span>{downloadProgress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
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
        className="w-full px-6 py-3 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
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
            Starting...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="6" />
            </svg>
            Start Recording
          </>
        )}
      </button>

      <button
        onClick={onOpenSettings}
        className="mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        Settings
      </button>
    </div>
  )
}
