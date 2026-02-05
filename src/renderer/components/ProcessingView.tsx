export function ProcessingView() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Processing your recording"
    >
      <div className="mb-6">
        <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-white animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      </div>

      <h2 className="text-xl font-medium text-white mb-2">Processing</h2>
      <p className="text-sm text-gray-400 text-center" aria-live="polite">
        Transcribing your feedback...
      </p>
      <p className="text-xs text-gray-500 text-center mt-1">
        This may take a few seconds
      </p>

      <div className="mt-6 w-full">
        <div
          className="h-1 bg-gray-700 rounded-full overflow-hidden"
          role="progressbar"
          aria-label="Processing progress"
          aria-valuetext="Processing in progress"
        >
          <div className="h-full bg-blue-500 animate-pulse w-2/3" />
        </div>
      </div>
    </div>
  )
}
