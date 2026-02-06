/**
 * PermissionManager Unit Tests
 *
 * Tests the centralized macOS permission handling:
 * - Permission status checking for microphone, screen, accessibility
 * - checkAllPermissions aggregation
 * - isGranted convenience method
 * - Non-macOS fallback behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { systemPreferences } from 'electron';

// Mock the ErrorHandler used by PermissionManager (must be before import)
vi.mock('../../src/main/ErrorHandler', () => ({
  errorHandler: {
    log: vi.fn(),
  },
}));

// Must import after electron mock is set up by tests/setup.ts
import PermissionManager from '../../src/main/PermissionManager';

describe('PermissionManager', () => {
  let manager: PermissionManager;

  beforeEach(() => {
    manager = new PermissionManager();
    vi.clearAllMocks();
  });

  describe('getPermissionStatus', () => {
    it('should return microphone status from systemPreferences', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const status = await manager.getPermissionStatus('microphone');

      expect(status).toBe('granted');
      expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('microphone');
    });

    it('should return screen status from systemPreferences', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');

      const status = await manager.getPermissionStatus('screen');

      expect(status).toBe('denied');
      expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith('screen');
    });

    it('should return accessibility status using isTrustedAccessibilityClient', async () => {
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);

      const status = await manager.getPermissionStatus('accessibility');

      expect(status).toBe('granted');
    });

    it('should return denied for accessibility when not trusted', async () => {
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false);

      const status = await manager.getPermissionStatus('accessibility');

      expect(status).toBe('denied');
    });

    it('should return unknown for errors', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation(() => {
        throw new Error('System error');
      });

      const status = await manager.getPermissionStatus('microphone');

      expect(status).toBe('unknown');
    });
  });

  describe('isGranted', () => {
    it('should return true when permission is granted', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');

      const granted = await manager.isGranted('microphone');

      expect(granted).toBe(true);
    });

    it('should return false when permission is denied', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');

      const granted = await manager.isGranted('microphone');

      expect(granted).toBe(false);
    });

    it('should return false when permission is not-determined', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('not-determined');

      const granted = await manager.isGranted('screen');

      expect(granted).toBe(false);
    });
  });

  describe('checkAllPermissions', () => {
    it('should return allGranted=true when all required permissions granted', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);

      const result = await manager.checkAllPermissions();

      expect(result.allGranted).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.state.microphone).toBe('granted');
      expect(result.state.screen).toBe('granted');
      expect(result.state.accessibility).toBe('granted');
    });

    it('should report missing microphone permission', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation((type: string) => {
        if (type === 'microphone') return 'denied';
        return 'granted';
      });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);

      const result = await manager.checkAllPermissions();

      expect(result.allGranted).toBe(false);
      expect(result.missing).toContain('microphone');
      expect(result.missing).not.toContain('screen');
    });

    it('should report missing screen permission', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation((type: string) => {
        if (type === 'screen') return 'not-determined';
        return 'granted';
      });
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(true);

      const result = await manager.checkAllPermissions();

      expect(result.allGranted).toBe(false);
      expect(result.missing).toContain('screen');
    });

    it('should not report accessibility as missing (it is optional)', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('granted');
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false);

      const result = await manager.checkAllPermissions();

      // Accessibility is optional so missing array should be empty
      expect(result.allGranted).toBe(true);
      expect(result.missing).not.toContain('accessibility');
      expect(result.state.accessibility).toBe('denied');
    });

    it('should report multiple missing permissions', async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue('denied');
      vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(false);

      const result = await manager.checkAllPermissions();

      expect(result.allGranted).toBe(false);
      expect(result.missing).toContain('microphone');
      expect(result.missing).toContain('screen');
      expect(result.missing).toHaveLength(2);
    });
  });
});
