import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

export interface AudioConfig {
  sampleRate: number
  channels: number
  format: 'wav' | 'mp3'
}

const DEFAULT_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  format: 'wav'
}

export class AudioService extends EventEmitter {
  private config: AudioConfig
  private recordingProcess: ChildProcess | null = null
  private currentPath: string | null = null
  private isRecording = false
  private recordingsDir: string

  constructor(config: Partial<AudioConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.recordingsDir = join(app.getPath('userData'), 'recordings')
    this.ensureRecordingsDir()
  }

  private ensureRecordingsDir(): void {
    if (!existsSync(this.recordingsDir)) {
      mkdirSync(this.recordingsDir, { recursive: true })
    }
  }

  async startRecording(sessionId: string): Promise<string> {
    if (this.isRecording) {
      throw new Error('Already recording')
    }

    const filename = `${sessionId}.${this.config.format}`
    const outputPath = join(this.recordingsDir, filename)
    this.currentPath = outputPath

    return new Promise((resolve, reject) => {
      // Use macOS sox/rec for audio recording
      // Falls back to ffmpeg if available
      const args = [
        '-q',
        '-r', String(this.config.sampleRate),
        '-c', String(this.config.channels),
        '-b', '16',
        '-e', 'signed-integer',
        '-t', 'coreaudio',
        'default',
        outputPath
      ]

      try {
        this.recordingProcess = spawn('rec', args, {
          stdio: ['pipe', 'pipe', 'pipe']
        })

        this.recordingProcess.on('error', (err) => {
          // rec not found, try ffmpeg
          if (err.message.includes('ENOENT')) {
            this.startWithFfmpeg(outputPath)
              .then(resolve)
              .catch(reject)
          } else {
            this.isRecording = false
            reject(err)
          }
        })

        this.recordingProcess.stderr?.on('data', (data) => {
          const str = data.toString()
          if (str.includes('error') || str.includes('Error')) {
            console.error('Recording error:', str)
          }
        })

        // Give it a moment to start
        setTimeout(() => {
          if (this.recordingProcess && !this.recordingProcess.killed) {
            this.isRecording = true
            this.emit('started', outputPath)
            resolve(outputPath)
          }
        }, 200)

      } catch (err) {
        reject(err)
      }
    })
  }

  private async startWithFfmpeg(outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-f', 'avfoundation',
        '-i', ':0',
        '-ar', String(this.config.sampleRate),
        '-ac', String(this.config.channels),
        '-y',
        outputPath
      ]

      try {
        this.recordingProcess = spawn('ffmpeg', args, {
          stdio: ['pipe', 'pipe', 'pipe']
        })

        this.recordingProcess.on('error', (err) => {
          this.isRecording = false
          if (err.message.includes('ENOENT')) {
            reject(new Error('No audio recording tool found. Please install sox or ffmpeg.'))
          } else {
            reject(err)
          }
        })

        setTimeout(() => {
          if (this.recordingProcess && !this.recordingProcess.killed) {
            this.isRecording = true
            this.emit('started', outputPath)
            resolve(outputPath)
          }
        }, 300)

      } catch (err) {
        reject(err)
      }
    })
  }

  async stopRecording(): Promise<string | null> {
    if (!this.isRecording || !this.recordingProcess) {
      return this.currentPath
    }

    return new Promise((resolve) => {
      const path = this.currentPath
      const process = this.recordingProcess

      const cleanup = () => {
        this.isRecording = false
        this.recordingProcess = null
        this.emit('stopped', path)
        resolve(path)
      }

      if (!process) {
        cleanup()
        return
      }

      process.on('close', cleanup)
      process.on('exit', cleanup)

      // Send SIGTERM for graceful shutdown
      process.kill('SIGTERM')

      // Force kill after timeout
      setTimeout(() => {
        if (this.recordingProcess && !this.recordingProcess.killed) {
          this.recordingProcess.kill('SIGKILL')
        }
        cleanup()
      }, 2000)
    })
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording
  }

  getCurrentPath(): string | null {
    return this.currentPath
  }

  async checkMicrophonePermission(): Promise<boolean> {
    // On macOS, we need microphone permission
    // This will be checked when we try to start recording
    // For now, return true and handle the error if permission is denied
    return true
  }

  destroy(): void {
    if (this.recordingProcess) {
      this.recordingProcess.kill('SIGKILL')
      this.recordingProcess = null
    }
    this.isRecording = false
    this.removeAllListeners()
  }
}
