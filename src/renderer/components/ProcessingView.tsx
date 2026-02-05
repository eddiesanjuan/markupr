// macOS-style large spinner component (12-segment)
const MacSpinnerLarge = () => (
  <div className="macos-spinner-large" aria-hidden="true">
    {[...Array(12)].map((_, i) => (
      <div key={i} className="macos-spinner-segment-large" />
    ))}
  </div>
)

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
        <MacSpinnerLarge />
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
          className="h-1 bg-white/10 rounded-full overflow-hidden"
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
