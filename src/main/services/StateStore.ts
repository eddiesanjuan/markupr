import { app } from "electron";
import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { writeFile } from "fs/promises";
import { SessionState } from "./SessionController";
import type { SessionData } from "./SessionController";
import { logger } from "../utils/logger";

const VALID_STATES = new Set(Object.values(SessionState));

const STATE_FILE = "session-state.json";
const PERSIST_INTERVAL = 5000; // 5 seconds

export class StateStore {
  private stateDir: string;
  private statePath: string;
  private persistInterval: NodeJS.Timeout | null = null;
  private pendingState: SessionData | null = null;

  constructor() {
    this.stateDir = join(app.getPath("userData"), "state");
    this.statePath = join(this.stateDir, STATE_FILE);
    this.ensureStateDir();
  }

  private ensureStateDir(): void {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
  }

  async save(session: SessionData): Promise<void> {
    this.pendingState = session;

    // Debounce writes
    if (!this.persistInterval) {
      this.persistInterval = setInterval(() => {
        this.flush();
      }, PERSIST_INTERVAL);
    }

    // Always write immediately for critical state changes
    const criticalStates = ["starting", "recording", "stopping", "processing"];
    if (criticalStates.includes(session.state)) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!this.pendingState) return;

    try {
      const data = JSON.stringify(this.pendingState, null, 2);
      await writeFile(this.statePath, data, "utf-8");
    } catch (err) {
      logger.error("Failed to persist state:", err);
      return;
    }

    this.pendingState = null;
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }
  }

  async load(): Promise<SessionData | null> {
    try {
      if (!existsSync(this.statePath)) {
        return null;
      }

      const data = readFileSync(this.statePath, "utf-8");
      const parsed: unknown = JSON.parse(data);

      if (!this.isValidSessionData(parsed)) {
        logger.error("Invalid session data in state file, discarding");
        return null;
      }

      return parsed;
    } catch (err) {
      logger.error("Failed to load state:", err);
      return null;
    }
  }

  private isValidSessionData(data: unknown): data is SessionData {
    if (data === null || typeof data !== "object") return false;

    const obj = data as Record<string, unknown>;

    // Required string fields
    if (typeof obj.id !== "string" || obj.id.length === 0) return false;
    if (typeof obj.state !== "string" || !VALID_STATES.has(obj.state as SessionState))
      return false;

    // Required number field
    if (typeof obj.stateEnteredAt !== "number") return false;

    // Nullable number fields
    if (obj.startedAt !== null && typeof obj.startedAt !== "number") return false;
    if (obj.stoppedAt !== null && typeof obj.stoppedAt !== "number") return false;

    // Nullable string fields
    if (obj.audioPath !== null && typeof obj.audioPath !== "string") return false;
    if (obj.transcript !== null && typeof obj.transcript !== "string") return false;
    if (obj.markdownOutput !== null && typeof obj.markdownOutput !== "string") return false;
    if (obj.reportPath !== null && typeof obj.reportPath !== "string") return false;
    if (obj.error !== null && typeof obj.error !== "string") return false;

    // Screenshots must be an array of strings
    if (!Array.isArray(obj.screenshots)) return false;
    if (!obj.screenshots.every((s: unknown) => typeof s === "string")) return false;

    return true;
  }

  async clear(): Promise<void> {
    this.pendingState = null;

    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }

    try {
      if (existsSync(this.statePath)) {
        unlinkSync(this.statePath);
      }
    } catch (err) {
      logger.error("Failed to clear state:", err);
    }
  }

  hasPersistedState(): boolean {
    return existsSync(this.statePath);
  }

  destroy(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }
    // Final synchronous flush - use sync write to ensure data is saved before exit
    if (this.pendingState) {
      try {
        const data = JSON.stringify(this.pendingState, null, 2);
        writeFileSync(this.statePath, data, "utf-8");
      } catch (err) {
        logger.error("Failed to persist final state:", err);
      }
    }
  }
}
