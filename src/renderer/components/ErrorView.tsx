interface ErrorViewProps {
  error: string | null
  onReset: () => void
}

export function ErrorView({ error, onReset }: ErrorViewProps) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full p-6"
      role="alert"
      aria-live="assertive"
    >
      <div className="mb-6">
        <div className="w-16 h-16 rounded-full bg-orange-600 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
      </div>

      <h2 className="text-xl font-medium text-white mb-2">Something went wrong</h2>
      <p className="text-sm text-gray-400 text-center mb-6">
        {error || 'An unexpected error occurred'}
      </p>

      <button
        onClick={onReset}
        aria-label="Try again, start a new recording"
        className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
      >
        Try Again
      </button>
    </div>
  )
}
