import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream } from 'fs'
import { get } from 'https'

export enum TranscriptionTier {
  WHISPER_LOCAL = 'whisper_local',
  MACOS_DICTATION = 'macos_dictation',
  NONE = 'none'
}

export interface TranscriptionConfig {
  preferredTier: TranscriptionTier
  whisperModel: 'tiny' | 'base' | 'small' | 'medium'
  language: string
}

const DEFAULT_CONFIG: TranscriptionConfig = {
  preferredTier: TranscriptionTier.WHISPER_LOCAL,
  whisperModel: 'base',
  language: 'en'
}

const WHISPER_MODELS = {
  tiny: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    size: 75_000_000
  },
  base: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    size: 142_000_000
  },
  small: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    size: 466_000_000
  },
  medium: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
    size: 1_500_000_000
  }
}

export class TranscriptionService extends EventEmitter {
  private config: TranscriptionConfig
  private modelsDir: string
  private isDownloading = false

  constructor(config: Partial<TranscriptionConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.modelsDir = join(app.getPath('userData'), 'models')
    this.ensureModelsDir()
  }

  private ensureModelsDir(): void {
    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true })
    }
  }

  getModelPath(): string {
    return join(this.modelsDir, `ggml-${this.config.whisperModel}.en.bin`)
  }

  isModelDownloaded(): boolean {
    return existsSync(this.getModelPath())
  }

  async downloadModel(
    onProgress?: (percent: number) => void
  ): Promise<boolean> {
    if (this.isDownloading) {
      return false
    }

    if (this.isModelDownloaded()) {
      return true
    }

    this.isDownloading = true
    const modelInfo = WHISPER_MODELS[this.config.whisperModel]
    const modelPath = this.getModelPath()

    return new Promise((resolve) => {
      const file = createWriteStream(modelPath)
      let downloadedBytes = 0

      const request = get(modelInfo.url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            get(redirectUrl, (redirectResponse) => {
              const totalBytes = parseInt(redirectResponse.headers['content-length'] || String(modelInfo.size), 10)

              redirectResponse.on('data', (chunk) => {
                downloadedBytes += chunk.length
                const percent = Math.round((downloadedBytes / totalBytes) * 100)
                onProgress?.(percent)
                this.emit('downloadProgress', percent)
              })

              redirectResponse.pipe(file)

              file.on('finish', () => {
                file.close()
                this.isDownloading = false
                this.emit('downloadComplete')
                resolve(true)
              })
            }).on('error', () => {
              this.isDownloading = false
              resolve(false)
            })
          }
        } else {
          const totalBytes = parseInt(response.headers['content-length'] || String(modelInfo.size), 10)

          response.on('data', (chunk) => {
            downloadedBytes += chunk.length
            const percent = Math.round((downloadedBytes / totalBytes) * 100)
            onProgress?.(percent)
            this.emit('downloadProgress', percent)
          })

          response.pipe(file)

          file.on('finish', () => {
            file.close()
            this.isDownloading = false
            this.emit('downloadComplete')
            resolve(true)
          })
        }
      })

      request.on('error', () => {
        this.isDownloading = false
        resolve(false)
      })
    })
  }

  async transcribe(audioPath: string): Promise<string> {
    // Try Whisper first
    if (this.isModelDownloaded()) {
      try {
        const result = await this.transcribeWithWhisper(audioPath)
        if (result && result.trim()) {
          return result
        }
      } catch (err) {
        console.warn('Whisper transcription failed, falling back:', err)
      }
    }

    // Fallback to macOS dictation simulation (just return placeholder for now)
    return this.transcribeWithFallback(audioPath)
  }

  private async transcribeWithWhisper(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const modelPath = this.getModelPath()

      // Try to use whisper.cpp binary if available
      const whisperBinary = this.findWhisperBinary()
      if (!whisperBinary) {
        reject(new Error('Whisper binary not found'))
        return
      }

      const args = [
        '-m', modelPath,
        '-f', audioPath,
        '-l', this.config.language,
        '--no-timestamps',
        '-otxt'
      ]

      const process = spawn(whisperBinary, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      let error = ''

      process.stdout?.on('data', (data) => {
        output += data.toString()
      })

      process.stderr?.on('data', (data) => {
        error += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim())
        } else {
          reject(new Error(`Whisper exited with code ${code}: ${error}`))
        }
      })

      process.on('error', reject)

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!process.killed) {
          process.kill()
          reject(new Error('Whisper transcription timed out'))
        }
      }, 60000)
    })
  }

  private findWhisperBinary(): string | null {
    // Check common locations for whisper.cpp binary
    const locations = [
      '/usr/local/bin/whisper',
      '/opt/homebrew/bin/whisper',
      join(app.getPath('userData'), 'bin', 'whisper'),
      'whisper' // PATH
    ]

    for (const loc of locations) {
      if (existsSync(loc)) {
        return loc
      }
    }

    // Try PATH
    return 'whisper'
  }

  private async transcribeWithFallback(audioPath: string): Promise<string> {
    // For now, return a message indicating transcription is not available
    // In a full implementation, this could use macOS Speech Recognition
    console.log('Using fallback transcription for:', audioPath)
    return '[Transcription requires Whisper model. Click settings to download.]'
  }

  getAvailableTier(): TranscriptionTier {
    if (this.isModelDownloaded()) {
      return TranscriptionTier.WHISPER_LOCAL
    }
    return TranscriptionTier.NONE
  }

  setConfig(config: Partial<TranscriptionConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): TranscriptionConfig {
    return { ...this.config }
  }

  destroy(): void {
    this.removeAllListeners()
  }
}
