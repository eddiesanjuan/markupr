import { app } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

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
        this.sessions = JSON.parse(data);
      }
    } catch (err) {
      console.error("Failed to load session history:", err);
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
      console.error("Failed to save session history:", err);
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
