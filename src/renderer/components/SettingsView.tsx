import { useTranscription } from '../hooks/useTranscription'
import { DonateButton } from './DonateButton'

// SF Symbol: chevron.backward
const ChevronBackIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
  </svg>
)

interface SettingsViewProps {
  onBack: () => void
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { isModelReady, isDownloading, downloadProgress, config, downloadModel, updateConfig } = useTranscription()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <button
          onClick={onBack}
          aria-label="Go back to main view"
          className="p-1 hover:bg-white/10 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <ChevronBackIcon className="w-5 h-5 text-gray-400" />
        </button>
        <h2 className="text-lg font-medium text-white">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Transcription Settings */}
        <section aria-labelledby="transcription-heading">
          <h3 id="transcription-heading" className="text-sm font-medium text-gray-300 mb-3">Transcription</h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="whisper-model" className="text-sm text-gray-400">Whisper Model</label>
              <select
                id="whisper-model"
                value={config?.whisperModel || 'base'}
                onChange={(e) => updateConfig({ whisperModel: e.target.value as 'tiny' | 'base' | 'small' | 'medium' })}
                aria-label="Select Whisper model size"
                className="bg-white/10 text-white text-sm rounded px-2 py-1 border border-white/10 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="tiny">Tiny (~75MB)</option>
                <option value="base">Base (~140MB)</option>
                <option value="small">Small (~460MB)</option>
                <option value="medium">Medium (~1.5GB)</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span id="model-status-label" className="text-sm text-gray-400">Model Status</span>
                <p className="text-xs text-gray-500" aria-describedby="model-status-label">
                  {isModelReady ? 'Ready to use' : 'Not downloaded'}
                </p>
              </div>
              {!isModelReady && !isDownloading && (
                <button
                  onClick={downloadModel}
                  aria-label="Download transcription model"
                  className="px-3 py-1.5 btn-macos btn-macos-primary text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Download
                </button>
              )}
              {isDownloading && (
                <div className="flex items-center gap-2" role="status" aria-live="polite">
                  <div
                    className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={downloadProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Download progress: ${downloadProgress} percent`}
                  >
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400" aria-hidden="true">{downloadProgress}%</span>
                </div>
              )}
              {isModelReady && (
                <span className="text-sm text-green-400" role="status">Ready</span>
              )}
            </div>
          </div>
        </section>

        {/* Language Settings */}
        <section aria-labelledby="language-heading">
          <h3 id="language-heading" className="text-sm font-medium text-gray-300 mb-3">Language</h3>
          <label htmlFor="language-select" className="sr-only">Select transcription language</label>
          <select
            id="language-select"
            value={config?.language || 'en'}
            onChange={(e) => updateConfig({ language: e.target.value })}
            aria-label="Select transcription language"
            className="w-full bg-white/10 text-white text-sm rounded px-3 py-2 border border-white/10 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="zh">Chinese</option>
          </select>
        </section>

        {/* About */}
        <section aria-labelledby="about-heading">
          <h3 id="about-heading" className="text-sm font-medium text-gray-300 mb-3">About</h3>
          <div className="text-sm text-gray-400 space-y-1">
            <p>FeedbackFlow v0.2.0</p>
            <p className="text-xs text-gray-500">
              Voice-to-AI feedback capture for developers
            </p>
          </div>
        </section>
      </div>

      <div className="p-4 border-t border-white/10 flex justify-center">
        <DonateButton />
      </div>
    </div>
  )
}
