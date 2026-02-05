import { EventEmitter } from "events";
import { spawn } from "child_process";
import { app } from "electron";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  createReadStream,
  readFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "fs";
import { get } from "https";
import { createHash } from "crypto";
import type { IncomingMessage } from "http";
import { logger } from "../utils/logger";

export enum TranscriptionTier {
  WHISPER_LOCAL = "whisper_local",
  MACOS_DICTATION = "macos_dictation",
  NONE = "none",
}

export interface TranscriptionConfig {
  preferredTier: TranscriptionTier;
  whisperModel: "tiny" | "base" | "small" | "medium";
  language: string;
}

export interface TranscribeOptions {
  signal?: AbortSignal;
}

const DEFAULT_CONFIG: TranscriptionConfig = {
  preferredTier: TranscriptionTier.WHISPER_LOCAL,
  whisperModel: "base",
  language: "en",
};

const WHISPER_MODELS = {
  tiny: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    size: 75_000_000,
    sha256: "921e4cf8b07c5e53f3e68fc5ae1402e8c2a20aa8e62bee96d6a09138e9b38d5b",
  },
  base: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    size: 142_000_000,
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  },
  small: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    size: 466_000_000,
    sha256: "e58ab97db21e1da2b66f704de7be30e7e82c0116deab0316a77e02ca3e598773",
  },
  medium: {
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
    size: 1_500_000_000,
    sha256: "fd4762df2ca46e9c9e489e5db2a6de7dae08c027a32a4e9c4a8d5b5f8e6c7d6a",
  },
};

export class TranscriptionService extends EventEmitter {
  private config: TranscriptionConfig;
  private modelsDir: string;
  private isDownloading = false;

  constructor(config: Partial<TranscriptionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.modelsDir = join(app.getPath("userData"), "models");
    this.ensureModelsDir();
  }

  private ensureModelsDir(): void {
    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true });
    }
  }

  getModelPath(): string {
    return join(this.modelsDir, `ggml-${this.config.whisperModel}.en.bin`);
  }

  private async verifyChecksum(filePath: string, expectedHash: string): Promise<boolean> {
    return new Promise((resolve) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => {
        const fileHash = hash.digest("hex");
        if (fileHash === expectedHash) {
          logger.log("Model checksum verified successfully");
          resolve(true);
        } else {
          logger.error(`Model checksum mismatch: expected ${expectedHash}, got ${fileHash}`);
          resolve(false);
        }
      });
      stream.on("error", (err) => {
        logger.error("Failed to verify checksum:", err);
        resolve(false);
      });
    });
  }

  isModelDownloaded(): boolean {
    const modelPath = this.getModelPath();
    if (!existsSync(modelPath)) return false;

    try {
      const modelInfo = WHISPER_MODELS[this.config.whisperModel];
      const stats = statSync(modelPath);
      return stats.size >= modelInfo.size;
    } catch {
      return false;
    }
  }

  async downloadModel(
    onProgress?: (percent: number) => void,
  ): Promise<boolean> {
    if (this.isDownloading) {
      return false;
    }

    if (this.isModelDownloaded()) {
      return true;
    }

    this.isDownloading = true;
    const modelInfo = WHISPER_MODELS[this.config.whisperModel];
    const modelPath = this.getModelPath();
    const tempPath = `${modelPath}.download`;

    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    return new Promise((resolve) => {
      const file = createWriteStream(tempPath);
      let downloadedBytes = 0;
      let settled = false;

      const finalize = (success: boolean) => {
        if (settled) return;
        settled = true;
        this.isDownloading = false;

        if (!success) {
          try {
            file.destroy();
          } catch {
            // Ignore cleanup errors
          }
          try {
            unlinkSync(tempPath);
          } catch {
            // Ignore cleanup errors
          }
          resolve(false);
          return;
        }

        this.emit("downloadComplete");
        resolve(true);
      };

      const handleResponse = (response: IncomingMessage) => {
        const status = response.statusCode || 0;
        const locationHeader = response.headers.location;
        const redirectUrl = Array.isArray(locationHeader)
          ? locationHeader[0]
          : locationHeader;

        if (status >= 300 && status < 400 && redirectUrl) {
          response.resume();
          makeRequest(redirectUrl);
          return;
        }

        if (status >= 400) {
          response.resume();
          finalize(false);
          return;
        }

        const lengthHeader = response.headers["content-length"];
        const totalBytes = parseInt(
          Array.isArray(lengthHeader)
            ? lengthHeader[0]
            : lengthHeader || String(modelInfo.size),
          10,
        );

        response.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const percent = Math.min(
            100,
            Math.round((downloadedBytes / totalBytes) * 100),
          );
          onProgress?.(percent);
          this.emit("downloadProgress", percent);
        });

        response.on("error", () => {
          finalize(false);
        });

        response.pipe(file);
      };

      const makeRequest = (url: string) => {
        const request = get(url, (response) => handleResponse(response));
        request.on("error", () => {
          finalize(false);
        });
      };

      file.on("error", () => {
        finalize(false);
      });

      file.on("finish", () => {
        file.close(async () => {
          try {
            // Verify checksum before accepting the download
            if (modelInfo.sha256) {
              const valid = await this.verifyChecksum(tempPath, modelInfo.sha256);
              if (!valid) {
                logger.error("Model download failed checksum verification");
                try { unlinkSync(tempPath); } catch { /* ignore */ }
                finalize(false);
                return;
              }
            }
            renameSync(tempPath, modelPath);
            finalize(true);
          } catch {
            finalize(false);
          }
        });
      });

      makeRequest(modelInfo.url);
    });
  }

  async transcribe(
    audioPath: string,
    options: TranscribeOptions = {},
  ): Promise<string> {
    const { signal } = options;

    if (signal?.aborted) {
      throw new Error("Transcription aborted before start");
    }

    // Try Whisper first
    if (this.isModelDownloaded()) {
      try {
        const result = await this.transcribeWithWhisper(audioPath, signal);
        if (result && result.trim()) {
          return result;
        }
      } catch (err) {
        if (signal?.aborted) {
          throw new Error("Transcription aborted");
        }
        logger.warn("Whisper transcription failed, falling back:", err);
      }
    }

    // Fallback to macOS dictation simulation (just return placeholder for now)
    return this.transcribeWithFallback(audioPath);
  }

  private async transcribeWithWhisper(
    audioPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const modelPath = this.getModelPath();

      // Try to use whisper.cpp binary if available
      const whisperBinary = this.findWhisperBinary();
      if (!whisperBinary) {
        reject(
          new Error(
            "Whisper binary not found. Install with: brew install whisper-cpp",
          ),
        );
        return;
      }

      const args = [
        "-m",
        modelPath,
        "-f",
        audioPath,
        "-l",
        this.config.language,
        "--no-timestamps",
        "-otxt",
      ];

      const whisperProcess = spawn(whisperBinary, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let output = "";
      let error = "";
      let timeoutId: NodeJS.Timeout | null = null;
      let aborted = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        signal?.removeEventListener("abort", handleAbort);
      };

      const handleAbort = () => {
        if (!whisperProcess.killed) {
          aborted = true;
          whisperProcess.kill("SIGKILL");
          cleanup();
          reject(new Error("Transcription aborted"));
        }
      };

      // Set up abort handler
      if (signal) {
        if (signal.aborted) {
          whisperProcess.kill("SIGKILL");
          reject(new Error("Transcription aborted"));
          return;
        }
        signal.addEventListener("abort", handleAbort, { once: true });
      }

      whisperProcess.stdout?.on("data", (data) => {
        output += data.toString();
      });

      whisperProcess.stderr?.on("data", (data) => {
        error += data.toString();
      });

      whisperProcess.on("close", (code) => {
        cleanup();
        if (aborted) {
          return; // Already rejected
        }
        if (code === 0) {
          const trimmed = output.trim();
          if (trimmed) {
            resolve(trimmed);
            return;
          }

          const outputPath = `${audioPath}.txt`;
          if (existsSync(outputPath)) {
            try {
              const fileOutput = readFileSync(outputPath, "utf-8").trim();
              if (fileOutput) {
                resolve(fileOutput);
                return;
              }
            } catch (readErr) {
              logger.warn("Failed to read whisper output file:", readErr);
            }
          }

          resolve(trimmed);
        } else {
          reject(new Error(`Whisper exited with code ${code}: ${error}`));
        }
      });

      whisperProcess.on("error", (err) => {
        cleanup();
        if (!aborted) {
          reject(err);
        }
      });

      // Timeout after 60 seconds
      timeoutId = setTimeout(() => {
        if (!whisperProcess.killed) {
          whisperProcess.kill();
          reject(new Error("Whisper transcription timed out"));
        }
      }, 60000);
    });
  }

  private findWhisperBinary(): string | null {
    // Check common locations for whisper.cpp binary
    const locations = [
      "/usr/local/bin/whisper",
      "/opt/homebrew/bin/whisper",
      "/usr/local/bin/whisper-cpp",
      "/opt/homebrew/bin/whisper-cpp",
      join(app.getPath("userData"), "bin", "whisper"),
    ];

    for (const loc of locations) {
      if (existsSync(loc)) {
        return loc;
      }
    }

    return this.findBinaryInPath(["whisper", "whisper-cpp"]);
  }

  private findBinaryInPath(candidates: string[]): string | null {
    const envPath = process.env.PATH;
    if (!envPath) return null;

    const dirs = envPath.split(":");
    for (const dir of dirs) {
      for (const candidate of candidates) {
        const fullPath = join(dir, candidate);
        if (existsSync(fullPath)) {
          return fullPath;
        }
      }
    }

    return null;
  }

  private async transcribeWithFallback(audioPath: string): Promise<string> {
    // Return helpful message based on what's missing
    logger.log("Using fallback transcription for:", audioPath);

    if (!this.isModelDownloaded()) {
      return "[Transcription requires Whisper model. Click Settings to download.]";
    }

    if (!this.findWhisperBinary()) {
      return "[Whisper not installed. Run: brew install whisper-cpp]";
    }

    return "[Transcription unavailable. Check Settings for configuration.]";
  }

  getAvailableTier(): TranscriptionTier {
    if (this.isModelDownloaded()) {
      return TranscriptionTier.WHISPER_LOCAL;
    }
    return TranscriptionTier.NONE;
  }

  setConfig(config: Partial<TranscriptionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): TranscriptionConfig {
    return { ...this.config };
  }

  destroy(): void {
    this.removeAllListeners();
  }
}
