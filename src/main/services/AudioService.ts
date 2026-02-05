import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import { app } from "electron";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { logger } from "../utils/logger";

export interface AudioConfig {
  sampleRate: number;
  channels: number;
  format: "wav" | "mp3";
}

export interface StartRecordingOptions {
  signal?: AbortSignal;
}

export interface StopRecordingOptions {
  signal?: AbortSignal;
}

const DEFAULT_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  format: "wav",
};

export class AudioService extends EventEmitter {
  private config: AudioConfig;
  private recordingProcess: ChildProcess | null = null;
  private currentPath: string | null = null;
  private isRecording = false;
  private recordingsDir: string;

  constructor(config: Partial<AudioConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.recordingsDir = join(app.getPath("userData"), "recordings");
    this.ensureRecordingsDir();
  }

  private ensureRecordingsDir(): void {
    if (!existsSync(this.recordingsDir)) {
      mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  async startRecording(
    sessionId: string,
    options: StartRecordingOptions = {},
  ): Promise<string> {
    const { signal } = options;

    if (signal?.aborted) {
      throw new Error("Recording aborted before start");
    }

    if (this.isRecording) {
      throw new Error("Already recording");
    }

    const filename = `${sessionId}.${this.config.format}`;
    const outputPath = join(this.recordingsDir, filename);
    this.currentPath = outputPath;

    // Set up abort handler
    const abortHandler = () => {
      if (this.recordingProcess && !this.recordingProcess.killed) {
        this.recordingProcess.kill("SIGKILL");
        this.isRecording = false;
        this.recordingProcess = null;
      }
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      const result = await this.startWithRec(outputPath);
      return result;
    } catch (err) {
      const isMissingBinary =
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT";
      if (isMissingBinary) {
        return this.startWithFfmpeg(outputPath);
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", abortHandler);
    }
  }

  private async startWithRec(outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Use sox/rec for audio recording (preferred)
      // Falls back to ffmpeg if rec is not available
      const args = [
        "-q",
        "-r",
        String(this.config.sampleRate),
        "-c",
        String(this.config.channels),
        "-b",
        "16",
        "-e",
        "signed-integer",
        "-t",
        "coreaudio",
        "default",
        outputPath,
      ];

      let settled = false;
      let stderrBuffer = "";
      const STARTUP_GRACE_PERIOD = 300; // ms to wait after spawn to verify process stays alive

      const markStarted = () => {
        if (settled) return;
        settled = true;
        this.isRecording = true;
        this.emit("started", outputPath);
        resolve(outputPath);
      };

      const handleError = (error: Error) => {
        if (settled) return;
        settled = true;
        this.isRecording = false;
        this.recordingProcess = null;
        reject(error);
      };

      try {
        this.recordingProcess = spawn("rec", args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        handleError(error as Error);
        return;
      }

      // Collect stderr for error reporting
      this.recordingProcess.stderr?.on("data", (data) => {
        const str = data.toString();
        stderrBuffer += str;
        if (str.includes("error") || str.includes("Error")) {
          logger.error("Recording error:", str);
        }
      });

      // Handle early exit during startup grace period
      const handleEarlyExit = (code: number | null) => {
        if (settled) {
          // Process exited after successful start - emit fatal error
          this.isRecording = false;
          this.recordingProcess = null;
          this.emit(
            "fatalError",
            new Error(
              stderrBuffer || `Recording process exited with code ${code}`,
            ),
          );
          return;
        }
        // Process exited before we marked it as started
        const errorMsg =
          stderrBuffer.trim() ||
          `Recording process exited immediately with code ${code}`;
        handleError(new Error(errorMsg));
      };

      this.recordingProcess.once("exit", handleEarlyExit);
      this.recordingProcess.once("close", handleEarlyExit);
      this.recordingProcess.once("error", handleError);

      // Wait for spawn, then verify process survives grace period
      this.recordingProcess.once("spawn", () => {
        setTimeout(() => {
          // If still not settled and process is alive, mark as started
          if (
            !settled &&
            this.recordingProcess &&
            !this.recordingProcess.killed
          ) {
            // Remove early exit handlers and add normal runtime handlers
            this.recordingProcess.removeListener("exit", handleEarlyExit);
            this.recordingProcess.removeListener("close", handleEarlyExit);

            // Add runtime exit handler for fatal errors during recording
            this.recordingProcess.once("exit", (code) => {
              if (this.isRecording) {
                this.isRecording = false;
                this.recordingProcess = null;
                this.emit(
                  "fatalError",
                  new Error(
                    stderrBuffer ||
                      `Recording process exited unexpectedly with code ${code}`,
                  ),
                );
              }
            });

            markStarted();
          }
        }, STARTUP_GRACE_PERIOD);
      });
    });
  }

  private async startWithFfmpeg(outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // avfoundation format: "video_device:audio_device"
      // ":0" = no video capture, audio device index 0 (macOS system default input)
      const args = [
        "-f",
        "avfoundation",
        "-i",
        ":0",
        "-ar",
        String(this.config.sampleRate),
        "-ac",
        String(this.config.channels),
        "-y",
        outputPath,
      ];

      let settled = false;
      let stderrBuffer = "";
      const STARTUP_GRACE_PERIOD = 300; // ms to wait after spawn to verify process stays alive

      const markStarted = () => {
        if (settled) return;
        settled = true;
        this.isRecording = true;
        this.emit("started", outputPath);
        resolve(outputPath);
      };

      const handleError = (error: Error) => {
        if (settled) return;
        settled = true;
        this.isRecording = false;
        this.recordingProcess = null;
        const isMissingBinary =
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT";
        if (isMissingBinary) {
          reject(
            new Error(
              "Audio recording failed. Please ensure ffmpeg is installed (brew install ffmpeg) and microphone access is granted.",
            ),
          );
        } else {
          reject(error);
        }
      };

      try {
        this.recordingProcess = spawn("ffmpeg", args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        handleError(error as Error);
        return;
      }

      // Collect stderr for error reporting
      this.recordingProcess.stderr?.on("data", (data) => {
        const str = data.toString();
        stderrBuffer += str;
        if (str.includes("error") || str.includes("Error")) {
          logger.error("Recording error:", str);
        }
      });

      // Handle early exit during startup grace period
      const handleEarlyExit = (code: number | null) => {
        if (settled) {
          // Process exited after successful start - emit fatal error
          this.isRecording = false;
          this.recordingProcess = null;
          this.emit(
            "fatalError",
            new Error(
              stderrBuffer || `Recording process exited with code ${code}`,
            ),
          );
          return;
        }
        // Process exited before we marked it as started
        const errorMsg =
          stderrBuffer.trim() ||
          `Recording process exited immediately with code ${code}`;
        handleError(new Error(errorMsg));
      };

      this.recordingProcess.once("exit", handleEarlyExit);
      this.recordingProcess.once("close", handleEarlyExit);
      this.recordingProcess.once("error", handleError);

      // Wait for spawn, then verify process survives grace period
      this.recordingProcess.once("spawn", () => {
        setTimeout(() => {
          // If still not settled and process is alive, mark as started
          if (
            !settled &&
            this.recordingProcess &&
            !this.recordingProcess.killed
          ) {
            // Remove early exit handlers and add normal runtime handlers
            this.recordingProcess.removeListener("exit", handleEarlyExit);
            this.recordingProcess.removeListener("close", handleEarlyExit);

            // Add runtime exit handler for fatal errors during recording
            this.recordingProcess.once("exit", (code) => {
              if (this.isRecording) {
                this.isRecording = false;
                this.recordingProcess = null;
                this.emit(
                  "fatalError",
                  new Error(
                    stderrBuffer ||
                      `Recording process exited unexpectedly with code ${code}`,
                  ),
                );
              }
            });

            markStarted();
          }
        }, STARTUP_GRACE_PERIOD);
      });
    });
  }

  async stopRecording(options: StopRecordingOptions = {}): Promise<string | null> {
    const { signal } = options;

    if (!this.isRecording || !this.recordingProcess) {
      return this.currentPath;
    }

    return new Promise((resolve) => {
      const path = this.currentPath;
      const process = this.recordingProcess;
      let didCleanup = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (didCleanup) return;
        didCleanup = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        signal?.removeEventListener("abort", forceKill);
        this.isRecording = false;
        this.recordingProcess = null;
        this.emit("stopped", path);
        resolve(path);
      };

      const forceKill = () => {
        if (this.recordingProcess && !this.recordingProcess.killed) {
          this.recordingProcess.kill("SIGKILL");
        }
        cleanup();
      };

      // If signal is already aborted, force kill immediately
      if (signal?.aborted) {
        forceKill();
        return;
      }

      // Set up abort handler for immediate kill
      signal?.addEventListener("abort", forceKill, { once: true });

      if (!process) {
        cleanup();
        return;
      }

      process.once("close", cleanup);
      process.once("exit", cleanup);

      // Send SIGTERM for graceful shutdown
      process.kill("SIGTERM");

      // Force kill after timeout
      timeoutId = setTimeout(() => {
        if (this.recordingProcess && !this.recordingProcess.killed) {
          this.recordingProcess.kill("SIGKILL");
        }
        cleanup();
      }, 2000);
    });
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  getCurrentPath(): string | null {
    return this.currentPath;
  }

  destroy(): void {
    if (this.recordingProcess) {
      this.recordingProcess.kill("SIGKILL");
      this.recordingProcess = null;
    }
    this.isRecording = false;
    this.removeAllListeners();
  }
}
