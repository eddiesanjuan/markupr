import { describe, expect, it, vi } from 'vitest';
import { TierManager } from '../../src/main/transcription/TierManager';
import type { TierStatus } from '../../src/main/transcription/types';

function makeStatuses(
  overrides: Partial<Record<TierStatus['tier'], TierStatus>>
): TierStatus[] {
  const defaults: TierStatus[] = [
    { tier: 'deepgram', available: false, reason: 'No API key configured' },
    { tier: 'whisper', available: false, reason: 'Model not downloaded' },
    { tier: 'macos-dictation', available: true },
    { tier: 'timer-only', available: true },
  ];

  return defaults.map((status) => overrides[status.tier] ?? status);
}

describe('TierManager preference selection', () => {
  it('prefers Deepgram by default when auto mode and Deepgram is available', async () => {
    const manager = new TierManager();
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: true },
        whisper: { tier: 'whisper', available: true },
      })
    );

    const selected = await manager.selectBestTier();
    expect(selected).toBe('deepgram');
  });

  it('uses preferred Whisper when available', async () => {
    const manager = new TierManager();
    manager.setPreferredTier('whisper');
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: true },
        whisper: { tier: 'whisper', available: true },
      })
    );

    const selected = await manager.selectBestTier();
    expect(selected).toBe('whisper');
  });

  it('falls back automatically when preferred tier is unavailable', async () => {
    const manager = new TierManager();
    manager.setPreferredTier('deepgram');
    vi.spyOn(manager, 'getTierStatuses').mockResolvedValue(
      makeStatuses({
        deepgram: { tier: 'deepgram', available: false, reason: 'No internet' },
        whisper: { tier: 'whisper', available: true },
      })
    );

    const selected = await manager.selectBestTier();
    expect(selected).toBe('whisper');
  });

  it('rejects non-transcribing preferred tiers in strict feedback mode', () => {
    const manager = new TierManager();
    expect(() => manager.setPreferredTier('timer-only')).toThrow(
      'does not provide transcription'
    );
  });
});
