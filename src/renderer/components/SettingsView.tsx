import { useTranscription } from '../hooks/useTranscription'
import { DonateButton } from './DonateButton'

interface SettingsViewProps {
  onBack: () => void
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { isModelReady, isDownloading, downloadProgress, config, downloadModel, updateConfig } = useTranscription()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b border-gray-700">
        <button
          onClick={onBack}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
        >
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-lg font-medium text-white">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Transcription Settings */}
        <section>
          <h3 className="text-sm font-medium text-gray-300 mb-3">Transcription</h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Whisper Model</span>
              <select
                value={config?.whisperModel || 'base'}
                onChange={(e) => updateConfig({ whisperModel: e.target.value as 'tiny' | 'base' | 'small' | 'medium' })}
                className="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                <option value="tiny">Tiny (~75MB)</option>
                <option value="base">Base (~140MB)</option>
                <option value="small">Small (~460MB)</option>
                <option value="medium">Medium (~1.5GB)</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-400">Model Status</span>
                <p className="text-xs text-gray-500">
                  {isModelReady ? 'Ready to use' : 'Not downloaded'}
                </p>
              </div>
              {!isModelReady && !isDownloading && (
                <button
                  onClick={downloadModel}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                >
                  Download
                </button>
              )}
              {isDownloading && (
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">{downloadProgress}%</span>
                </div>
              )}
              {isModelReady && (
                <span className="text-sm text-green-400">Ready</span>
              )}
            </div>
          </div>
        </section>

        {/* Language Settings */}
        <section>
          <h3 className="text-sm font-medium text-gray-300 mb-3">Language</h3>
          <select
            value={config?.language || 'en'}
            onChange={(e) => updateConfig({ language: e.target.value })}
            className="w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
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
        <section>
          <h3 className="text-sm font-medium text-gray-300 mb-3">About</h3>
          <div className="text-sm text-gray-400 space-y-1">
            <p>FeedbackFlow v0.1.0</p>
            <p className="text-xs text-gray-500">
              Voice-to-AI feedback capture for developers
            </p>
          </div>
        </section>
      </div>

      <div className="p-4 border-t border-gray-700 flex justify-center">
        <DonateButton />
      </div>
    </div>
  )
}
