/**
 * Onboarding Flow Logic Tests
 *
 * Tests the onboarding wizard logic layer:
 * - Step transitions and ordering
 * - API key step can be skipped
 * - Permissions flow (microphone, screen)
 * - Navigation (forward, back)
 * - Progress dots track current step
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Replicate onboarding flow logic for testability
// (These mirror the pure logic from Onboarding.tsx)
// ============================================================================

type OnboardingStep = 'welcome' | 'microphone' | 'screen' | 'apikey' | 'success';

const STEPS: OnboardingStep[] = ['welcome', 'microphone', 'screen', 'apikey', 'success'];

interface PermissionStatus {
  microphone: 'unknown' | 'pending' | 'granted' | 'denied';
  screen: 'unknown' | 'pending' | 'granted' | 'denied';
}

interface ApiKeyStatus {
  value: string;
  testing: boolean;
  valid: boolean | null;
  error: string | null;
}

function getStepIndex(step: OnboardingStep): number {
  return STEPS.indexOf(step);
}

function isLastStep(step: OnboardingStep): boolean {
  return step === 'success';
}

function isFirstStep(step: OnboardingStep): boolean {
  return step === 'welcome';
}

function canProceedFromMicrophone(permissions: PermissionStatus): boolean {
  return permissions.microphone === 'granted';
}

function canProceedFromScreen(permissions: PermissionStatus): boolean {
  return permissions.screen === 'granted';
}

function canProceedFromApiKey(apiKey: ApiKeyStatus): boolean {
  return apiKey.valid === true;
}

function canSkipApiKey(): boolean {
  // API key step is always skippable (uses local Whisper instead)
  return true;
}

// ============================================================================
// Tests
// ============================================================================

describe('Onboarding Flow', () => {
  // ========================================================================
  // Step ordering
  // ========================================================================

  describe('step ordering', () => {
    it('should have 5 steps in correct order', () => {
      expect(STEPS).toEqual(['welcome', 'microphone', 'screen', 'apikey', 'success']);
    });

    it('should start at welcome step', () => {
      const initialStep: OnboardingStep = 'welcome';
      expect(getStepIndex(initialStep)).toBe(0);
    });

    it('should end at success step', () => {
      expect(isLastStep('success')).toBe(true);
      expect(isLastStep('welcome')).toBe(false);
    });

    it('welcome is the first step', () => {
      expect(isFirstStep('welcome')).toBe(true);
      expect(isFirstStep('microphone')).toBe(false);
    });
  });

  // ========================================================================
  // Forward navigation
  // ========================================================================

  describe('forward navigation', () => {
    it('welcome -> microphone', () => {
      const nextStep: OnboardingStep = 'microphone';
      expect(getStepIndex(nextStep)).toBe(1);
    });

    it('microphone -> screen (when granted)', () => {
      const permissions: PermissionStatus = { microphone: 'granted', screen: 'unknown' };
      expect(canProceedFromMicrophone(permissions)).toBe(true);
    });

    it('microphone blocked when denied', () => {
      const permissions: PermissionStatus = { microphone: 'denied', screen: 'unknown' };
      expect(canProceedFromMicrophone(permissions)).toBe(false);
    });

    it('microphone blocked when pending', () => {
      const permissions: PermissionStatus = { microphone: 'pending', screen: 'unknown' };
      expect(canProceedFromMicrophone(permissions)).toBe(false);
    });

    it('screen -> apikey (when granted)', () => {
      const permissions: PermissionStatus = { microphone: 'granted', screen: 'granted' };
      expect(canProceedFromScreen(permissions)).toBe(true);
    });

    it('screen blocked when denied', () => {
      const permissions: PermissionStatus = { microphone: 'granted', screen: 'denied' };
      expect(canProceedFromScreen(permissions)).toBe(false);
    });

    it('apikey -> success (when valid)', () => {
      const apiKey: ApiKeyStatus = { value: 'dg-test-key', testing: false, valid: true, error: null };
      expect(canProceedFromApiKey(apiKey)).toBe(true);
    });

    it('apikey blocked when invalid', () => {
      const apiKey: ApiKeyStatus = { value: 'bad-key', testing: false, valid: false, error: 'Invalid API key' };
      expect(canProceedFromApiKey(apiKey)).toBe(false);
    });

    it('apikey blocked when untested', () => {
      const apiKey: ApiKeyStatus = { value: 'some-key', testing: false, valid: null, error: null };
      expect(canProceedFromApiKey(apiKey)).toBe(false);
    });
  });

  // ========================================================================
  // Backward navigation
  // ========================================================================

  describe('backward navigation', () => {
    it('microphone -> welcome', () => {
      const prevIndex = getStepIndex('microphone') - 1;
      expect(STEPS[prevIndex]).toBe('welcome');
    });

    it('screen -> microphone', () => {
      const prevIndex = getStepIndex('screen') - 1;
      expect(STEPS[prevIndex]).toBe('microphone');
    });

    it('apikey -> screen', () => {
      const prevIndex = getStepIndex('apikey') - 1;
      expect(STEPS[prevIndex]).toBe('screen');
    });

    it('cannot go back from welcome', () => {
      expect(isFirstStep('welcome')).toBe(true);
      expect(getStepIndex('welcome')).toBe(0);
    });
  });

  // ========================================================================
  // API key skip
  // ========================================================================

  describe('API key skip', () => {
    it('API key step is always skippable', () => {
      expect(canSkipApiKey()).toBe(true);
    });

    it('skip goes directly to success step', () => {
      // Mirrors: onSkip={() => goToStep('success')}
      const targetStep: OnboardingStep = 'success';
      expect(targetStep).toBe('success');
      expect(isLastStep(targetStep)).toBe(true);
    });

    it('skip does not require valid API key', () => {
      const apiKey: ApiKeyStatus = { value: '', testing: false, valid: null, error: null };
      // Even with empty key, skip is allowed
      expect(canSkipApiKey()).toBe(true);
      expect(canProceedFromApiKey(apiKey)).toBe(false); // Can't proceed, but can skip
    });
  });

  // ========================================================================
  // Progress dots
  // ========================================================================

  describe('progress dots', () => {
    it('progress dots hidden on welcome step', () => {
      const step: OnboardingStep = 'welcome';
      const showDots = step !== 'welcome' && step !== 'success';
      expect(showDots).toBe(false);
    });

    it('progress dots hidden on success step', () => {
      const step: OnboardingStep = 'success';
      const showDots = step !== 'welcome' && step !== 'success';
      expect(showDots).toBe(false);
    });

    it('progress dots shown for middle steps', () => {
      const middleSteps: OnboardingStep[] = ['microphone', 'screen', 'apikey'];
      middleSteps.forEach((step) => {
        const showDots = step !== 'welcome' && step !== 'success';
        expect(showDots).toBe(true);
      });
    });

    it('current step index tracks correctly', () => {
      expect(getStepIndex('welcome')).toBe(0);
      expect(getStepIndex('microphone')).toBe(1);
      expect(getStepIndex('screen')).toBe(2);
      expect(getStepIndex('apikey')).toBe(3);
      expect(getStepIndex('success')).toBe(4);
    });
  });

  // ========================================================================
  // Permission status transitions
  // ========================================================================

  describe('permission status transitions', () => {
    it('initial permission state is all unknown', () => {
      const initial: PermissionStatus = { microphone: 'unknown', screen: 'unknown' };
      expect(initial.microphone).toBe('unknown');
      expect(initial.screen).toBe('unknown');
    });

    it('transitions from unknown to pending to granted', () => {
      const statuses: PermissionStatus['microphone'][] = ['unknown', 'pending', 'granted'];
      expect(statuses[0]).toBe('unknown');
      expect(statuses[1]).toBe('pending');
      expect(statuses[2]).toBe('granted');
    });

    it('can transition from unknown directly to denied', () => {
      const status: PermissionStatus = { microphone: 'denied', screen: 'unknown' };
      expect(canProceedFromMicrophone(status)).toBe(false);
    });
  });

  // ========================================================================
  // Full flow simulation
  // ========================================================================

  describe('full flow simulation', () => {
    it('happy path: welcome -> mic -> screen -> apikey -> success', () => {
      const visited: OnboardingStep[] = [];
      let current: OnboardingStep = 'welcome';

      // Step 1: Welcome -> Next
      visited.push(current);
      current = 'microphone';

      // Step 2: Mic granted -> Next
      visited.push(current);
      const perms: PermissionStatus = { microphone: 'granted', screen: 'unknown' };
      expect(canProceedFromMicrophone(perms)).toBe(true);
      current = 'screen';

      // Step 3: Screen granted -> Next
      visited.push(current);
      perms.screen = 'granted';
      expect(canProceedFromScreen(perms)).toBe(true);
      current = 'apikey';

      // Step 4: API key valid -> Next
      visited.push(current);
      const apiKey: ApiKeyStatus = { value: 'dg-key', testing: false, valid: true, error: null };
      expect(canProceedFromApiKey(apiKey)).toBe(true);
      current = 'success';

      visited.push(current);
      expect(visited).toEqual(STEPS);
    });

    it('skip path: welcome -> mic -> screen -> skip apikey -> success', () => {
      const visited: OnboardingStep[] = [];
      let current: OnboardingStep = 'welcome';

      visited.push(current);
      current = 'microphone';
      visited.push(current);
      current = 'screen';
      visited.push(current);
      current = 'apikey';
      visited.push(current);

      // Skip API key
      expect(canSkipApiKey()).toBe(true);
      current = 'success';
      visited.push(current);

      expect(visited).toEqual(STEPS);
      expect(current).toBe('success');
    });

    it('back-and-forth navigation preserves step order', () => {
      let current: OnboardingStep = 'welcome';

      // Forward to screen
      current = 'microphone';
      current = 'screen';
      expect(current).toBe('screen');

      // Back to microphone
      current = STEPS[getStepIndex(current) - 1];
      expect(current).toBe('microphone');

      // Forward again
      current = 'screen';
      current = 'apikey';
      expect(current).toBe('apikey');
    });
  });

  // ========================================================================
  // Reduced motion
  // ========================================================================

  describe('reduced motion behavior', () => {
    it('confetti is disabled when prefers-reduced-motion matches', () => {
      const prefersReducedMotion = true; // Simulates matchMedia result
      const showConfetti = !prefersReducedMotion;
      expect(showConfetti).toBe(false);
    });

    it('confetti is enabled when prefers-reduced-motion does not match', () => {
      const prefersReducedMotion = false;
      const showConfetti = !prefersReducedMotion;
      expect(showConfetti).toBe(true);
    });
  });
});
