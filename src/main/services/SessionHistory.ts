import { app } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { logger } from "../utils/logger";

export interface RecentSession {
  id: string;
  reportPath: string;
  timestamp: number;
  duration: number;
  screenshotCount: number;
}

const HISTORY_FILE = "recent-sessions.json";
const MAX_SESSIONS = 5;

export class SessionHistory {
  private historyPath: string;
  private sessions: RecentSession[] = [];

  constructor() {
    const stateDir = join(app.getPath("userData"), "state");
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    this.historyPath = join(stateDir, HISTORY_FILE);
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.historyPath)) {
        const data = readFileSync(this.historyPath, "utf-8");
        const parsed: unknown = JSON.parse(data);

        if (!Array.isArray(parsed)) {
          logger.error("Session history is not an array, resetting to empty");
          this.sessions = [];
          return;
        }

        this.sessions = parsed.filter(
          (s): s is RecentSession =>
            s !== null &&
            typeof s === "object" &&
            typeof s.id === "string" &&
            typeof s.reportPath === "string" &&
            typeof s.timestamp === "number" &&
            typeof s.duration === "number" &&
            typeof s.screenshotCount === "number"
        );

        if (this.sessions.length !== parsed.length) {
          logger.warn(
            `Filtered ${parsed.length - this.sessions.length} invalid entries from session history`
          );
        }
      }
    } catch (err) {
      logger.error("Failed to load session history:", err);
      this.sessions = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(
        this.historyPath,
        JSON.stringify(this.sessions, null, 2),
        "utf-8"
      );
    } catch (err) {
      logger.error("Failed to save session history:", err);
    }
  }

  addSession(session: RecentSession): void {
    // Remove any existing entry with the same ID
    this.sessions = this.sessions.filter((s) => s.id !== session.id);

    // Add new session at the beginning
    this.sessions.unshift(session);

    // Keep only the last MAX_SESSIONS
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions = this.sessions.slice(0, MAX_SESSIONS);
    }

    this.save();
  }

  getSessions(): RecentSession[] {
    return [...this.sessions];
  }

  getSession(id: string): RecentSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  clear(): void {
    this.sessions = [];
    this.save();
  }
}
