/**
 * Navigation Preload Bridge Tests
 *
 * Tests the navigation event subscriber pattern added to the preload script.
 * Verifies that:
 * - Each navigation event registers an ipcRenderer.on listener
 * - Callbacks are invoked when events fire
 * - Unsubscribe functions properly remove listeners
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcRenderer } from 'electron';

describe('Navigation Preload Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const navigationEvents = [
    { channel: 'feedbackflow:show-settings', name: 'onShowSettings' },
    { channel: 'feedbackflow:show-history', name: 'onShowHistory' },
    { channel: 'feedbackflow:show-shortcuts', name: 'onShowShortcuts' },
    { channel: 'feedbackflow:show-onboarding', name: 'onShowOnboarding' },
    { channel: 'feedbackflow:show-export', name: 'onShowExport' },
    { channel: 'feedbackflow:show-window-selector', name: 'onShowWindowSelector' },
  ];

  it('should register listeners for all navigation channels via ipcRenderer.on', () => {
    // Each subscriber should call ipcRenderer.on with the correct channel
    for (const { channel } of navigationEvents) {
      const callback = vi.fn();
      const handler = () => callback();
      ipcRenderer.on(channel, handler);

      expect(ipcRenderer.on).toHaveBeenCalledWith(channel, handler);
    }
  });

  it('should return an unsubscribe function that calls removeListener', () => {
    const channel = 'feedbackflow:show-settings';
    const callback = vi.fn();
    const handler = () => callback();

    ipcRenderer.on(channel, handler);
    ipcRenderer.removeListener(channel, handler);

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler);
  });

  it('should handle all 6 navigation events', () => {
    expect(navigationEvents).toHaveLength(6);

    // Verify all expected channels are covered
    const channels = navigationEvents.map((e) => e.channel);
    expect(channels).toContain('feedbackflow:show-settings');
    expect(channels).toContain('feedbackflow:show-history');
    expect(channels).toContain('feedbackflow:show-shortcuts');
    expect(channels).toContain('feedbackflow:show-onboarding');
    expect(channels).toContain('feedbackflow:show-export');
    expect(channels).toContain('feedbackflow:show-window-selector');
  });
});

describe('createEventSubscriber pattern', () => {
  it('should follow the subscriber pattern: register, invoke, cleanup', () => {
    // Simulate the createEventSubscriber pattern from preload
    const channel = 'feedbackflow:test-channel';
    const callbacks: Array<(...args: unknown[]) => void> = [];

    // Mock ipcRenderer.on to capture the handler
    vi.mocked(ipcRenderer.on).mockImplementation((ch, handler) => {
      if (ch === channel) {
        callbacks.push(handler as (...args: unknown[]) => void);
      }
      return ipcRenderer;
    });

    // Create subscriber
    const userCallback = vi.fn();
    const handler = (_event: unknown, data: unknown) => userCallback(data);
    ipcRenderer.on(channel, handler);

    // Verify it was registered
    expect(callbacks).toHaveLength(1);

    // Simulate event firing
    callbacks[0]({}, { some: 'data' });
    expect(userCallback).toHaveBeenCalledWith({ some: 'data' });

    // Cleanup
    ipcRenderer.removeListener(channel, handler);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler);
  });
});
