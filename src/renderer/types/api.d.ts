export interface SessionData {
  id: string
  state: SessionState
  startedAt: number | null
  stoppedAt: number | null
  audioPath: string | null
  transcript: string | null
  screenshots: string[]
  error: string | null
  stateEnteredAt: number
}

export type SessionState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'processing'
  | 'complete'
  | 'error'

export interface TranscriptionConfig {
  preferredTier: 'whisper_local' | 'macos_dictation' | 'none'
  whisperModel: 'tiny' | 'base' | 'small' | 'medium'
  language: string
}

export interface API {
  send: (channel: string, ...args: unknown[]) => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
}

declare global {
  interface Window {
    api: API
    electron: {
      process: {
        versions: NodeJS.ProcessVersions
      }
    }
  }
}
