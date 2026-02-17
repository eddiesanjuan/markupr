/**
 * AutoUpdater Expanded Unit Tests
 *
 * Tests the AutoUpdaterManager logic that the original test file
 * covers via a testable double. These tests focus on:
 * - parseReleaseNotes edge cases (null, string, array, objects)
 * - shouldSuppressUpdateError logic
 * - Timer scheduling and cleanup
 * - destroy() cleanup
 * - checkForUpdates guards (download in progress, concurrent checks)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Testable logic extracted from AutoUpdaterManager
// =============================================================================

type UpdateStatusType =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'ready'
  | 'error';

interface UpdateManagerState {
  status: UpdateStatusType;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string | null;
  downloadProgress?: number;
}

class AutoUpdaterLogic {
  state: UpdateManagerState;
  private autoCheckEnabled = true;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private updaterAvailable: boolean;
  private isChecking = false;
  checkFn = vi.fn();

  constructor(updaterAvailable = true) {
    this.state = { status: 'idle', currentVersion: '2.5.0' };
    this.updaterAvailable = updaterAvailable;
  }

  parseReleaseNotes(
    notes: string | Array<string | { note?: string }> | null | undefined,
  ): string | null {
    if (!notes) return null;
    if (typeof notes === 'string') return notes;
    if (Array.isArray(notes)) {
      return notes
        .map((note) => {
          if (typeof note === 'string') return note;
          return note.note || '';
        })
        .join('\n\n');
    }
    return null;
  }

  private isTransientNetworkError(message: string): boolean {
    return (
      message.includes('err_internet_disconnected') ||
      message.includes('err_network_changed') ||
      message.includes('err_name_not_resolved') ||
      message.includes('econnrefused') ||
      message.includes('eai_again') ||
      message.includes('enotfound') ||
      message.includes('timed out') ||
      message.includes('timeout') ||
      message.includes('network request failed') ||
      message.includes('failed to fetch')
    );
  }

  shouldSuppressUpdateError(error: { message: string }, userInitiated: boolean): boolean {
    const message = error.message.toLowerCase();
    const isLocalBuildMetadataError = (
      message.includes('app-update.yml') ||
      message.includes('latest.yml') ||
      message.includes('enoent')
    );

    if (isLocalBuildMetadataError) {
      return true;
    }

    return !userInitiated && this.isTransientNetworkError(message);
  }

  scheduleAutoChecks(startupDelayMs: number, periodicIntervalMs: number): void {
    this.clearAutoCheckTimers();
    if (!this.autoCheckEnabled) return;

    this.startupTimer = setTimeout(() => {
      this.checkFn();
    }, startupDelayMs);

    this.periodicTimer = setInterval(() => {
      this.checkFn();
    }, periodicIntervalMs);
  }

  clearAutoCheckTimers(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  setAutoCheckEnabled(enabled: boolean): void {
    this.autoCheckEnabled = enabled;
  }

  destroy(): void {
    this.clearAutoCheckTimers();
    this.updaterAvailable = false;
  }

  async checkForUpdates(): Promise<unknown> {
    if (!this.updaterAvailable) return null;
    if (this.isChecking) return null;
    if (this.state.status === 'downloading') return null;

    this.isChecking = true;
    try {
      return await this.checkFn();
    } finally {
      this.isChecking = false;
    }
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('AutoUpdater Logic (expanded)', () => {
  let logic: AutoUpdaterLogic;

  beforeEach(() => {
    vi.useFakeTimers();
    logic = new AutoUpdaterLogic();
  });

  afterEach(() => {
    logic.clearAutoCheckTimers();
    vi.useRealTimers();
  });

  describe('parseReleaseNotes', () => {
    it('returns null for null input', () => {
      expect(logic.parseReleaseNotes(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(logic.parseReleaseNotes(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(logic.parseReleaseNotes('')).toBeNull();
    });

    it('returns string directly', () => {
      expect(logic.parseReleaseNotes('Bug fixes')).toBe('Bug fixes');
    });

    it('handles array of strings', () => {
      const result = logic.parseReleaseNotes(['Fix A', 'Fix B']);
      expect(result).toBe('Fix A\n\nFix B');
    });

    it('handles array of objects with note property', () => {
      const result = logic.parseReleaseNotes([
        { note: 'v2.5.0: New MCP server' },
        { note: 'v2.4.0: CLI tool' },
      ]);
      expect(result).toBe('v2.5.0: New MCP server\n\nv2.4.0: CLI tool');
    });

    it('handles mixed array of strings and objects', () => {
      const result = logic.parseReleaseNotes([
        'Simple note',
        { note: 'Structured note' },
      ]);
      expect(result).toBe('Simple note\n\nStructured note');
    });

    it('handles objects without note property', () => {
      const result = logic.parseReleaseNotes([
        {} as { note?: string },
        { note: 'Has note' },
      ]);
      expect(result).toBe('\n\nHas note');
    });
  });

  describe('shouldSuppressUpdateError', () => {
    it('suppresses app-update.yml errors', () => {
      expect(
        logic.shouldSuppressUpdateError({
          message: 'Cannot find module APP-UPDATE.YML',
        }, false),
      ).toBe(true);
    });

    it('suppresses latest.yml errors', () => {
      expect(
        logic.shouldSuppressUpdateError({
          message: 'HttpError: 404 - latest.yml not found',
        }, false),
      ).toBe(true);
    });

    it('suppresses ENOENT errors', () => {
      expect(
        logic.shouldSuppressUpdateError({
          message: 'ENOENT: no such file or directory',
        }, false),
      ).toBe(true);
    });

    it('suppresses network errors for background checks', () => {
      expect(
        logic.shouldSuppressUpdateError({ message: 'net::ERR_INTERNET_DISCONNECTED' }, false),
      ).toBe(true);
    });

    it('does not suppress network errors for manual checks', () => {
      expect(
        logic.shouldSuppressUpdateError({ message: 'Network request failed' }, true),
      ).toBe(false);
    });

    it('does not suppress permission errors', () => {
      expect(
        logic.shouldSuppressUpdateError({ message: 'EPERM: operation not permitted' }, true),
      ).toBe(false);
    });
  });

  describe('scheduleAutoChecks', () => {
    it('fires startup check after delay', () => {
      logic.scheduleAutoChecks(5000, 4 * 60 * 60 * 1000);

      expect(logic.checkFn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5000);
      expect(logic.checkFn).toHaveBeenCalledOnce();
    });

    it('fires periodic checks at interval', () => {
      logic.scheduleAutoChecks(1000, 10_000);

      vi.advanceTimersByTime(1000);
      expect(logic.checkFn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(10_000);
      expect(logic.checkFn).toHaveBeenCalledTimes(2);
    });

    it('does not schedule when auto-check is disabled', () => {
      logic.setAutoCheckEnabled(false);
      logic.scheduleAutoChecks(5000, 60_000);

      vi.advanceTimersByTime(120_000);
      expect(logic.checkFn).not.toHaveBeenCalled();
    });

    it('clears previous timers when rescheduling', () => {
      logic.scheduleAutoChecks(5000, 60_000);
      logic.scheduleAutoChecks(10_000, 120_000);

      vi.advanceTimersByTime(5000);
      expect(logic.checkFn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);
      expect(logic.checkFn).toHaveBeenCalledOnce();
    });
  });

  describe('clearAutoCheckTimers', () => {
    it('stops all scheduled timers', () => {
      logic.scheduleAutoChecks(1000, 5000);
      logic.clearAutoCheckTimers();

      vi.advanceTimersByTime(60_000);
      expect(logic.checkFn).not.toHaveBeenCalled();
    });

    it('is safe to call multiple times', () => {
      logic.clearAutoCheckTimers();
      logic.clearAutoCheckTimers();
      // No error thrown
    });
  });

  describe('destroy', () => {
    it('clears timers', () => {
      logic.scheduleAutoChecks(1000, 5000);
      logic.destroy();

      vi.advanceTimersByTime(60_000);
      expect(logic.checkFn).not.toHaveBeenCalled();
    });
  });

  describe('checkForUpdates guards', () => {
    it('returns null when updater is unavailable', async () => {
      const disabled = new AutoUpdaterLogic(false);
      expect(await disabled.checkForUpdates()).toBeNull();
    });

    it('returns null when download is in progress', async () => {
      logic.state.status = 'downloading';
      expect(await logic.checkForUpdates()).toBeNull();
      expect(logic.checkFn).not.toHaveBeenCalled();
    });

    it('prevents concurrent checks', async () => {
      logic.checkFn.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      const p1 = logic.checkForUpdates();
      const p2 = logic.checkForUpdates();

      vi.advanceTimersByTime(200);
      await Promise.all([p1, p2]);

      expect(logic.checkFn).toHaveBeenCalledOnce();
    });

    it('resets isChecking flag after check completes', async () => {
      logic.checkFn.mockResolvedValue({ version: '2.6.0' });
      await logic.checkForUpdates();

      logic.checkFn.mockResolvedValue({ version: '2.6.1' });
      await logic.checkForUpdates();

      expect(logic.checkFn).toHaveBeenCalledTimes(2);
    });

    it('resets isChecking flag even when check throws', async () => {
      logic.checkFn.mockRejectedValue(new Error('Network error'));
      await expect(logic.checkForUpdates()).rejects.toThrow('Network error');

      logic.checkFn.mockResolvedValue(null);
      await logic.checkForUpdates();
      expect(logic.checkFn).toHaveBeenCalledTimes(2);
    });
  });
});
