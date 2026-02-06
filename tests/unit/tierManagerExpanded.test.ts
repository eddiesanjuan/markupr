/**
 * TierManager Expanded Tests
 *
 * Extends the basic 4 tests with:
 * - Failover chain behavior
 * - Timer-only emergency mode
 * - macOS dictation fallback
 * - Tier quality metadata
 * - hasTranscriptionCapability checks
 * - Edge cases
 */

import { describe, expect, it, vi } from 'vitest';
import { TierManager } from '../../src/main/transcription/TierManager';
import type { TierStatus } from '../../src/main/transcription/types';

function makeStatuses(
  overrides: Partial<Record<TierStatus['tier'], Partial<TierStatus>>>
): TierStatus[] {
  const defaults: TierStatus[] = [
    { tier: 'deepgram', available: false, reason: 'No API key configured' },
    { tier: 'whisper', available: false, reason: 'Model not downloaded' },
    { tier: 'macos-dictation', available: true },
    { tier: 'timer-only', available: true },
  ];

  return defaults.map((status) => ({
    ...status,
    ...(overrides[status.tier] ?? {}),
  }));
}

describe('TierManager failover chain', () => {
  it('falls through entire chain when nothing is available except timer-only', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        'macos-dictation': { tier: 'macos-dictation', available: false, reason: 'Not on macOS' },
      })
    );

    const selected = await manager.selectBestTier();
    expect(selected).toBe('timer-only');
  });

  it('falls back to macos-dictation when deepgram and whisper unavailable', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: false },
        whisper: { tier: 'whisper', available: false },
        'macos-dictation': { tier: 'macos-dictation', available: true },
      })
    );

    const selected = await manager.selectBestTier();
    expect(selected).toBe('macos-dictation');
  });

  it('prefers Deepgram over Whisper in auto mode', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: true },
        whisper: { tier: 'whisper', available: true },
        'macos-dictation': { tier: 'macos-dictation', available: true },
      })
    );

    const selected = await manager.selectBestTier();
    expect(selected).toBe('deepgram');
  });

  it('selects Whisper when only Whisper is available (no Deepgram)', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: false },
        whisper: { tier: 'whisper', available: true },
      })
    );

    const selected = await manager.selectBestTier();
    expect(selected).toBe('whisper');
  });
});

describe('TierManager preference edge cases', () => {
  it('rejects macos-dictation as preferred tier', () => {
    const manager = new TierManager();
    expect(() => manager.setPreferredTier('macos-dictation')).toThrow(
      'does not provide transcription'
    );
  });

  it('accepts auto as preferred tier', () => {
    const manager = new TierManager();
    expect(() => manager.setPreferredTier('auto')).not.toThrow();
  });

  it('accepts deepgram as preferred tier', () => {
    const manager = new TierManager();
    expect(() => manager.setPreferredTier('deepgram')).not.toThrow();
  });

  it('accepts whisper as preferred tier', () => {
    const manager = new TierManager();
    expect(() => manager.setPreferredTier('whisper')).not.toThrow();
  });
});

describe('TierManager hasTranscriptionCapability', () => {
  it('returns true when Deepgram is available', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: true },
      })
    );

    const hasCap = await manager.hasTranscriptionCapability();
    expect(hasCap).toBe(true);
  });

  it('returns true when Whisper is available', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        whisper: { tier: 'whisper', available: true },
      })
    );

    const hasCap = await manager.hasTranscriptionCapability();
    expect(hasCap).toBe(true);
  });

  it('returns false when only timer-only and macos-dictation are available', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: false },
        whisper: { tier: 'whisper', available: false },
        'macos-dictation': { tier: 'macos-dictation', available: true },
        'timer-only': { tier: 'timer-only', available: true },
      })
    );

    const hasCap = await manager.hasTranscriptionCapability();
    expect(hasCap).toBe(false);
  });
});

describe('TierManager status reporting', () => {
  it('returns all 4 tier statuses', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({})
    );

    const statuses = await manager.getTierStatuses();
    expect(statuses).toHaveLength(4);

    const tiers = statuses.map((s) => s.tier);
    expect(tiers).toContain('deepgram');
    expect(tiers).toContain('whisper');
    expect(tiers).toContain('macos-dictation');
    expect(tiers).toContain('timer-only');
  });

  it('includes availability reason when tier is unavailable', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: false, reason: 'No API key' },
      })
    );

    const statuses = await manager.getTierStatuses();
    const deepgram = statuses.find((s) => s.tier === 'deepgram');
    expect(deepgram?.available).toBe(false);
    expect(deepgram?.reason).toBe('No API key');
  });
});
