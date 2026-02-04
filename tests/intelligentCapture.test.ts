/**
 * Tests for IntelligentCapture service
 *
 * Tests the intelligent screenshot trigger logic:
 * - Pause-triggered captures (utterance_end)
 * - Manual captures (hotkey)
 * - Debouncing
 * - Transcript window management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// =============================================================================
// Mocks
// =============================================================================

// Mock TranscriptionService
const mockTranscriptionService = {
  _events: new EventEmitter(),
  onUtteranceEnd: vi.fn((callback) => {
    mockTranscriptionService._events.on('utteranceEnd', callback);
    return () => mockTranscriptionService._events.off('utteranceEnd', callback);
  }),
  onTranscript: vi.fn((callback) => {
    mockTranscriptionService._events.on('transcript', callback);
    return () => mockTranscriptionService._events.off('transcript', callback);
  }),
  emitUtteranceEnd: (timestamp: number) => {
    mockTranscriptionService._events.emit('utteranceEnd', timestamp);
  },
  emitTranscript: (result: { text: string; isFinal: boolean; confidence: number; timestamp: number }) => {
    mockTranscriptionService._events.emit('transcript', result);
  },
};

// Mock ScreenCaptureService - function to create fresh mock
const createMockScreenCapture = () => ({
  capture: vi.fn().mockImplementation(() =>
    Promise.resolve({
      id: 'test-screenshot-id',
      buffer: Buffer.from('fake-image-data'),
      width: 1920,
      height: 1080,
      timestamp: Date.now(),
      sourceId: 'screen:1:0',
    })
  ),
});

let mockScreenCapture = createMockScreenCapture();

// Mock HotkeyManager
const mockHotkeyManager = {
  _events: new EventEmitter(),
  onHotkey: vi.fn((callback) => {
    mockHotkeyManager._events.on('hotkey', callback);
    return () => mockHotkeyManager._events.off('hotkey', callback);
  }),
  emitHotkey: (action: string) => {
    mockHotkeyManager._events.emit('hotkey', action);
  },
};

// =============================================================================
// Tests
// =============================================================================

describe('IntelligentCapture', () => {
  // Fresh import for each test to reset singleton state
  let IntelligentCaptureServiceImpl: typeof import('../src/main/capture/IntelligentCapture').IntelligentCaptureServiceImpl;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Reset mock services
    mockTranscriptionService._events.removeAllListeners();
    mockHotkeyManager._events.removeAllListeners();
    mockScreenCapture = createMockScreenCapture();

    // Re-import to get fresh singleton
    const module = await import('../src/main/capture/IntelligentCapture');
    IntelligentCaptureServiceImpl = module.IntelligentCaptureServiceImpl;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with service dependencies', () => {
      const service = new IntelligentCaptureServiceImpl();

      expect(() => {
        service.initialize(
          mockTranscriptionService as any,
          mockScreenCapture as any,
          mockHotkeyManager as any
        );
      }).not.toThrow();
    });

    it('should throw if start() called before initialize()', () => {
      const service = new IntelligentCaptureServiceImpl();

      expect(() => service.start()).toThrow('Service not initialized');
    });

    it('should throw if start() called before setSourceId()', () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );

      expect(() => service.start()).toThrow('Source ID not set');
    });

    it('should start successfully with all dependencies', () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');

      expect(() => service.start()).not.toThrow();
      expect(service.isActive()).toBe(true);
    });
  });

  describe('pause-triggered capture', () => {
    it('should capture screenshot on utterance end', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      // Emit utterance end
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);

      // Wait for async capture
      await vi.waitFor(() => {
        expect(mockScreenCapture.capture).toHaveBeenCalled();
      });

      await vi.waitFor(() => {
        expect(screenshotCallback).toHaveBeenCalled();
      });

      const [screenshot, decision] = screenshotCallback.mock.calls[0];
      expect(decision.trigger).toBe('pause');
      expect(decision.confidence).toBe(0.9);
    });

    it('should include transcript window in capture decision', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      // Emit some transcripts first
      mockTranscriptionService.emitTranscript({
        text: 'Hello world',
        isFinal: true,
        confidence: 0.95,
        timestamp: Date.now() / 1000,
      });

      mockTranscriptionService.emitTranscript({
        text: 'This is a test',
        isFinal: true,
        confidence: 0.92,
        timestamp: Date.now() / 1000,
      });

      // Then trigger capture
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);

      await vi.waitFor(() => {
        expect(screenshotCallback).toHaveBeenCalled();
      });

      const [_, decision] = screenshotCallback.mock.calls[0];
      expect(decision.transcriptWindow.length).toBeGreaterThanOrEqual(2);
      expect(decision.transcriptWindow.some((t: any) => t.text === 'Hello world')).toBe(true);
    });
  });

  describe('manual capture', () => {
    it('should capture screenshot on manual hotkey', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      // Emit manual screenshot hotkey
      mockHotkeyManager.emitHotkey('manualScreenshot');

      await vi.waitFor(() => {
        expect(mockScreenCapture.capture).toHaveBeenCalled();
      });

      await vi.waitFor(() => {
        expect(screenshotCallback).toHaveBeenCalled();
      });

      const [screenshot, decision] = screenshotCallback.mock.calls[0];
      expect(decision.trigger).toBe('manual');
      expect(decision.confidence).toBe(1.0);
    });

    it('should ignore other hotkey actions', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      // Emit different hotkey action
      mockHotkeyManager.emitHotkey('toggleRecording');

      // Wait a bit to ensure no capture
      await new Promise((r) => setTimeout(r, 100));

      expect(mockScreenCapture.capture).not.toHaveBeenCalled();
      expect(screenshotCallback).not.toHaveBeenCalled();
    });
  });

  describe('debouncing', () => {
    it('should debounce rapid captures within 500ms', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      // Trigger multiple captures rapidly
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);

      await vi.waitFor(() => {
        expect(mockScreenCapture.capture).toHaveBeenCalled();
      });

      // Should only have captured once
      expect(mockScreenCapture.capture).toHaveBeenCalledTimes(1);

      // Stats should show debounced count
      const stats = service.getStats();
      expect(stats.debouncedCount).toBeGreaterThan(0);
    });

    it('should allow captures after debounce period', async () => {
      vi.useFakeTimers();

      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      // First capture
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);
      await vi.runAllTimersAsync();

      // Advance past debounce period
      vi.advanceTimersByTime(600);

      // Second capture should work
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);
      await vi.runAllTimersAsync();

      expect(mockScreenCapture.capture).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('statistics', () => {
    it('should track capture statistics', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      // Initial stats
      let stats = service.getStats();
      expect(stats.totalCaptures).toBe(0);
      expect(stats.pauseCaptures).toBe(0);
      expect(stats.manualCaptures).toBe(0);

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      // Trigger a pause capture
      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);

      // Wait for screenshot callback to be called (confirms capture completed)
      await vi.waitFor(() => {
        expect(screenshotCallback).toHaveBeenCalled();
      });

      stats = service.getStats();
      expect(stats.totalCaptures).toBe(1);
      expect(stats.pauseCaptures).toBe(1);
      expect(stats.manualCaptures).toBe(0);
    });

    it('should track failed captures', async () => {
      const failingScreenCapture = {
        ...mockScreenCapture,
        capture: vi.fn().mockRejectedValue(new Error('Capture failed')),
      };

      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        failingScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      const errorCallback = vi.fn();
      service.onError(errorCallback);

      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);

      await vi.waitFor(() => {
        expect(failingScreenCapture.capture).toHaveBeenCalled();
      });

      await vi.waitFor(() => {
        expect(errorCallback).toHaveBeenCalled();
      });

      const stats = service.getStats();
      expect(stats.failedCount).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('should stop cleanly', () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();

      expect(service.isActive()).toBe(true);

      service.stop();

      expect(service.isActive()).toBe(false);
    });

    it('should not capture when stopped', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');
      service.start();
      service.stop();

      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);

      await new Promise((r) => setTimeout(r, 100));

      expect(mockScreenCapture.capture).not.toHaveBeenCalled();
    });

    it('should reset transcript window on start', async () => {
      const service = new IntelligentCaptureServiceImpl();
      service.initialize(
        mockTranscriptionService as any,
        mockScreenCapture as any,
        mockHotkeyManager as any
      );
      service.setSourceId('screen:1:0');

      // First session
      service.start();

      mockTranscriptionService.emitTranscript({
        text: 'First session transcript',
        isFinal: true,
        confidence: 0.95,
        timestamp: Date.now() / 1000,
      });

      service.stop();

      // Second session
      service.start();

      const screenshotCallback = vi.fn();
      service.onScreenshot(screenshotCallback);

      mockTranscriptionService.emitUtteranceEnd(Date.now() / 1000);

      await vi.waitFor(() => {
        expect(screenshotCallback).toHaveBeenCalled();
      });

      const [_, decision] = screenshotCallback.mock.calls[0];
      // Transcript window should be empty (reset on start)
      expect(decision.transcriptWindow.length).toBe(0);
    });
  });
});
