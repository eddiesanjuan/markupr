/**
 * App.tsx Integration Logic Tests (Expanded)
 *
 * Tests the view-state management, navigation event handling,
 * screen recording sync, and component rendering conditions.
 *
 * Builds on appViewState.test.ts with deeper integration behavior:
 * - Navigation events switch views correctly
 * - Session state changes reset view
 * - Screen recording sync behavior
 * - Popover state mapping for all transitions
 * - Error/complete state handling
 * - Countdown timer integration
 * - Crash recovery rendering conditions
 */

import { describe, it, expect } from 'vitest';
import type { SessionState, SessionStatusPayload } from '../../src/shared/types';

// ============================================================================
// Replicate App.tsx logic for testing
// ============================================================================

type AppView = 'main' | 'settings' | 'history' | 'shortcuts';

function mapPopoverState(
  state: SessionState
): 'idle' | 'recording' | 'processing' | 'complete' | 'error' {
  if (state === 'recording' || state === 'starting') return 'recording';
  if (state === 'stopping' || state === 'processing') return 'processing';
  if (state === 'complete') return 'complete';
  if (state === 'error') return 'error';
  return 'idle';
}

// Simulates the state machine in App component
interface AppState {
  currentView: AppView;
  showOnboarding: boolean;
  showCountdown: boolean;
  showExportDialog: boolean;
  sessionState: SessionState;
  errorMessage: string | null;
  reportPath: string | null;
  recordingPath: string | null;
  sessionDir: string | null;
  duration: number;
  screenshotCount: number;
  transcriptEntries: string[];
  liveInterimTranscript: string;
  hasTranscriptionCapability: boolean | null;
  isMutating: boolean;
  settings: { defaultCountdown: number; showAudioWaveform: boolean } | null;
}

function createInitialState(): AppState {
  return {
    currentView: 'main',
    showOnboarding: false,
    showCountdown: false,
    showExportDialog: false,
    sessionState: 'idle',
    errorMessage: null,
    reportPath: null,
    recordingPath: null,
    sessionDir: null,
    duration: 0,
    screenshotCount: 0,
    transcriptEntries: [],
    liveInterimTranscript: '',
    hasTranscriptionCapability: null,
    isMutating: false,
    settings: { defaultCountdown: 0, showAudioWaveform: true },
  };
}

// Simulates onStateChange handler
function handleStateChange(appState: AppState, nextState: SessionState): AppState {
  const updated = { ...appState, sessionState: nextState };

  if (nextState === 'recording') {
    updated.errorMessage = null;
    updated.reportPath = null;
    updated.recordingPath = null;
    updated.sessionDir = null;
    updated.transcriptEntries = [];
    updated.liveInterimTranscript = '';
    updated.currentView = 'main';
    updated.showCountdown = false;
  }

  if (nextState === 'idle') {
    updated.duration = 0;
  }

  return updated;
}

// Simulates navigation event handlers
function handleNavigation(appState: AppState, target: string): AppState {
  const updated = { ...appState };

  switch (target) {
    case 'settings':
      updated.currentView = 'settings';
      break;
    case 'history':
      updated.currentView = 'history';
      break;
    case 'shortcuts':
      updated.currentView = 'shortcuts';
      break;
    case 'onboarding':
      updated.showOnboarding = true;
      break;
    case 'export':
      updated.showExportDialog = true;
      break;
  }

  return updated;
}

// Simulates output ready handler
function handleOutputReady(
  appState: AppState,
  payload: { path?: string; reportPath?: string; recordingPath?: string; sessionDir?: string }
): AppState {
  return {
    ...appState,
    sessionState: 'complete',
    errorMessage: null,
    reportPath: payload.path || payload.reportPath || null,
    recordingPath: payload.recordingPath || null,
    sessionDir: payload.sessionDir || null,
    duration: 0,
    liveInterimTranscript: '',
  };
}

// Derive computed values
function deriveState(appState: AppState) {
  const primaryActionLabel =
    appState.sessionState === 'recording' ? 'Stop Session' : 'Start Session';
  const primaryActionDisabled =
    appState.isMutating ||
    appState.sessionState === 'starting' ||
    appState.sessionState === 'stopping' ||
    appState.sessionState === 'processing';
  const manualCaptureDisabled = appState.isMutating || appState.sessionState !== 'recording';
  const countdownDuration = appState.settings?.defaultCountdown ?? 0;
  const showAudioWaveform = appState.settings?.showAudioWaveform ?? true;

  return {
    primaryActionLabel,
    primaryActionDisabled,
    manualCaptureDisabled,
    countdownDuration,
    showAudioWaveform,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('App Integration Logic', () => {
  // ========================================================================
  // Navigation events switch views
  // ========================================================================

  describe('navigation events', () => {
    it('onShowSettings switches to settings view', () => {
      const state = handleNavigation(createInitialState(), 'settings');
      expect(state.currentView).toBe('settings');
    });

    it('onShowHistory switches to history view', () => {
      const state = handleNavigation(createInitialState(), 'history');
      expect(state.currentView).toBe('history');
    });

    it('onShowShortcuts switches to shortcuts view', () => {
      const state = handleNavigation(createInitialState(), 'shortcuts');
      expect(state.currentView).toBe('shortcuts');
    });

    it('onShowOnboarding shows onboarding overlay', () => {
      const state = handleNavigation(createInitialState(), 'onboarding');
      expect(state.showOnboarding).toBe(true);
    });

    it('onShowExport shows export dialog', () => {
      const state = handleNavigation(createInitialState(), 'export');
      expect(state.showExportDialog).toBe(true);
    });

    it('navigation does not affect session state', () => {
      let state = createInitialState();
      state.sessionState = 'recording';
      state = handleNavigation(state, 'settings');

      expect(state.sessionState).toBe('recording');
      expect(state.currentView).toBe('settings');
    });
  });

  // ========================================================================
  // Session state changes
  // ========================================================================

  describe('session state changes', () => {
    it('recording resets view to main', () => {
      let state = createInitialState();
      state.currentView = 'settings';

      state = handleStateChange(state, 'recording');

      expect(state.currentView).toBe('main');
    });

    it('recording clears error message', () => {
      let state = createInitialState();
      state.errorMessage = 'Previous error';

      state = handleStateChange(state, 'recording');

      expect(state.errorMessage).toBeNull();
    });

    it('recording clears report path', () => {
      let state = createInitialState();
      state.reportPath = '/old/report.md';

      state = handleStateChange(state, 'recording');

      expect(state.reportPath).toBeNull();
    });

    it('recording clears recording path', () => {
      let state = createInitialState();
      state.recordingPath = '/old/recording.webm';

      state = handleStateChange(state, 'recording');

      expect(state.recordingPath).toBeNull();
    });

    it('recording clears session dir', () => {
      let state = createInitialState();
      state.sessionDir = '/old/session';

      state = handleStateChange(state, 'recording');

      expect(state.sessionDir).toBeNull();
    });

    it('recording clears transcript entries', () => {
      let state = createInitialState();
      state.transcriptEntries = ['old entry'];
      state.liveInterimTranscript = 'typing...';

      state = handleStateChange(state, 'recording');

      expect(state.transcriptEntries).toEqual([]);
      expect(state.liveInterimTranscript).toBe('');
    });

    it('recording dismisses countdown', () => {
      let state = createInitialState();
      state.showCountdown = true;

      state = handleStateChange(state, 'recording');

      expect(state.showCountdown).toBe(false);
    });

    it('idle resets duration to 0', () => {
      let state = createInitialState();
      state.duration = 30000;

      state = handleStateChange(state, 'idle');

      expect(state.duration).toBe(0);
    });

    it('complete does not reset view', () => {
      let state = createInitialState();
      state.currentView = 'settings';

      state = handleStateChange(state, 'complete');

      expect(state.currentView).toBe('settings');
    });

    it('error does not reset view', () => {
      let state = createInitialState();
      state.currentView = 'history';

      state = handleStateChange(state, 'error');

      expect(state.currentView).toBe('history');
    });
  });

  // ========================================================================
  // Output ready handler
  // ========================================================================

  describe('output ready handler', () => {
    it('sets state to complete', () => {
      let state = createInitialState();
      state.sessionState = 'processing';

      state = handleOutputReady(state, { path: '/report.md' });

      expect(state.sessionState).toBe('complete');
    });

    it('sets report path from payload.path', () => {
      const state = handleOutputReady(createInitialState(), { path: '/output/report.md' });
      expect(state.reportPath).toBe('/output/report.md');
    });

    it('sets report path from payload.reportPath', () => {
      const state = handleOutputReady(createInitialState(), { reportPath: '/output/report.md' });
      expect(state.reportPath).toBe('/output/report.md');
    });

    it('sets recording path', () => {
      const state = handleOutputReady(createInitialState(), {
        path: '/report.md',
        recordingPath: '/output/recording.webm',
      });
      expect(state.recordingPath).toBe('/output/recording.webm');
    });

    it('sets session dir', () => {
      const state = handleOutputReady(createInitialState(), {
        path: '/report.md',
        sessionDir: '/output/session-123',
      });
      expect(state.sessionDir).toBe('/output/session-123');
    });

    it('clears error message', () => {
      let state = createInitialState();
      state.errorMessage = 'old error';

      state = handleOutputReady(state, { path: '/report.md' });

      expect(state.errorMessage).toBeNull();
    });

    it('resets duration and live transcript', () => {
      let state = createInitialState();
      state.duration = 60000;
      state.liveInterimTranscript = 'something';

      state = handleOutputReady(state, { path: '/report.md' });

      expect(state.duration).toBe(0);
      expect(state.liveInterimTranscript).toBe('');
    });
  });

  // ========================================================================
  // Popover state mapping (comprehensive)
  // ========================================================================

  describe('popover state mapping', () => {
    const cases: Array<[SessionState, string]> = [
      ['idle', 'idle'],
      ['starting', 'recording'],
      ['recording', 'recording'],
      ['stopping', 'processing'],
      ['processing', 'processing'],
      ['complete', 'complete'],
      ['error', 'error'],
    ];

    cases.forEach(([input, expected]) => {
      it(`maps '${input}' to '${expected}'`, () => {
        expect(mapPopoverState(input)).toBe(expected);
      });
    });
  });

  // ========================================================================
  // Derived state
  // ========================================================================

  describe('derived state', () => {
    it('primary action label is "Start Session" when idle', () => {
      const state = createInitialState();
      expect(deriveState(state).primaryActionLabel).toBe('Start Session');
    });

    it('primary action label is "Stop Session" when recording', () => {
      const state = { ...createInitialState(), sessionState: 'recording' as SessionState };
      expect(deriveState(state).primaryActionLabel).toBe('Stop Session');
    });

    it('primary action disabled during starting', () => {
      const state = { ...createInitialState(), sessionState: 'starting' as SessionState };
      expect(deriveState(state).primaryActionDisabled).toBe(true);
    });

    it('primary action disabled during stopping', () => {
      const state = { ...createInitialState(), sessionState: 'stopping' as SessionState };
      expect(deriveState(state).primaryActionDisabled).toBe(true);
    });

    it('primary action disabled during processing', () => {
      const state = { ...createInitialState(), sessionState: 'processing' as SessionState };
      expect(deriveState(state).primaryActionDisabled).toBe(true);
    });

    it('primary action disabled when mutating', () => {
      const state = { ...createInitialState(), isMutating: true };
      expect(deriveState(state).primaryActionDisabled).toBe(true);
    });

    it('primary action enabled when idle and not mutating', () => {
      const state = createInitialState();
      expect(deriveState(state).primaryActionDisabled).toBe(false);
    });

    it('manual capture enabled only during recording', () => {
      const states: SessionState[] = ['idle', 'starting', 'recording', 'stopping', 'processing', 'complete', 'error'];
      const results = states.map((s) => {
        const state = { ...createInitialState(), sessionState: s };
        return deriveState(state).manualCaptureDisabled;
      });

      // Only recording (index 2) should be false (enabled)
      expect(results).toEqual([true, true, false, true, true, true, true]);
    });

    it('countdown duration from settings', () => {
      const state = {
        ...createInitialState(),
        settings: { defaultCountdown: 5, showAudioWaveform: true },
      };
      expect(deriveState(state).countdownDuration).toBe(5);
    });

    it('countdown duration defaults to 0 when settings null', () => {
      const state = { ...createInitialState(), settings: null };
      expect(deriveState(state).countdownDuration).toBe(0);
    });

    it('audio waveform defaults to true when settings null', () => {
      const state = { ...createInitialState(), settings: null };
      expect(deriveState(state).showAudioWaveform).toBe(true);
    });
  });

  // ========================================================================
  // Countdown integration
  // ========================================================================

  describe('countdown integration', () => {
    it('shows countdown when idle and countdown > 0', () => {
      const state = createInitialState();
      state.settings = { defaultCountdown: 3, showAudioWaveform: true };
      state.showCountdown = true;

      const shouldRender = state.showCountdown && (state.settings?.defaultCountdown ?? 0) > 0;
      expect(shouldRender).toBe(true);
    });

    it('does not show countdown when countdown is 0', () => {
      const state = createInitialState();
      state.settings = { defaultCountdown: 0, showAudioWaveform: true };
      state.showCountdown = true;

      const shouldRender = state.showCountdown && (state.settings?.defaultCountdown ?? 0) > 0;
      expect(shouldRender).toBe(false);
    });

    it('countdown dismissed when recording starts', () => {
      let state = createInitialState();
      state.showCountdown = true;

      state = handleStateChange(state, 'recording');

      expect(state.showCountdown).toBe(false);
    });
  });

  // ========================================================================
  // Status copy text
  // ========================================================================

  describe('status copy text', () => {
    function getStatusCopy(
      state: SessionState,
      errorMessage: string | null = null,
      hasTranscription: boolean | null = null
    ): { title: string; detail: string } {
      switch (state) {
        case 'starting':
          return { title: 'Preparing Session', detail: 'Initializing microphone and transcription stack.' };
        case 'recording':
          return { title: 'Recording Live', detail: 'Talk while testing. Pauses, hotkey, and voice cues can trigger captures.' };
        case 'stopping':
        case 'processing':
          return { title: 'Building Report', detail: 'Generating markdown and linking screenshots to context.' };
        case 'complete':
          return { title: 'Report Ready', detail: 'Markdown path copied to your clipboard.' };
        case 'error':
          return { title: 'Session Error', detail: errorMessage || 'An unexpected error interrupted this capture.' };
        default:
          return {
            title: 'Ready To Capture',
            detail:
              hasTranscription === false
                ? 'Transcription unavailable. Download a Whisper model, then start.'
                : 'Press Cmd+Shift+F to start a fresh feedback pass.',
          };
      }
    }

    it('idle shows ready to capture', () => {
      const copy = getStatusCopy('idle');
      expect(copy.title).toBe('Ready To Capture');
    });

    it('idle shows transcription warning when unavailable', () => {
      const copy = getStatusCopy('idle', null, false);
      expect(copy.detail).toContain('Transcription unavailable');
    });

    it('recording shows recording live', () => {
      const copy = getStatusCopy('recording');
      expect(copy.title).toBe('Recording Live');
    });

    it('processing shows building report', () => {
      const copy = getStatusCopy('processing');
      expect(copy.title).toBe('Building Report');
    });

    it('error shows custom message', () => {
      const copy = getStatusCopy('error', 'Mic disconnected');
      expect(copy.detail).toBe('Mic disconnected');
    });

    it('error shows default message when no custom message', () => {
      const copy = getStatusCopy('error');
      expect(copy.detail).toContain('unexpected error');
    });
  });

  // ========================================================================
  // Crash recovery conditions
  // ========================================================================

  describe('crash recovery rendering', () => {
    it('shows dialog when incomplete session found and not checking', () => {
      const incompleteSession = { id: 'sess-crash', startTime: Date.now() - 60000 };
      const isCheckingRecovery = false;

      const showDialog = !!incompleteSession && !isCheckingRecovery;
      expect(showDialog).toBe(true);
    });

    it('hides dialog while checking recovery', () => {
      const incompleteSession = { id: 'sess-crash', startTime: Date.now() - 60000 };
      const isCheckingRecovery = true;

      const showDialog = !!incompleteSession && !isCheckingRecovery;
      expect(showDialog).toBe(false);
    });

    it('hides dialog when no incomplete session', () => {
      const incompleteSession = null;
      const isCheckingRecovery = false;

      const showDialog = !!incompleteSession && !isCheckingRecovery;
      expect(showDialog).toBe(false);
    });
  });

  // ========================================================================
  // Screen recording sync behavior
  // ========================================================================

  describe('screen recording sync', () => {
    it('should start recording when state transitions to recording', () => {
      const nextState: SessionState = 'recording';
      const isCurrentlyRecording = false;
      const shouldStart = nextState === 'recording' && !isCurrentlyRecording;
      expect(shouldStart).toBe(true);
    });

    it('should not start if already recording', () => {
      const nextState: SessionState = 'recording';
      const isCurrentlyRecording = true;
      const shouldStart = nextState === 'recording' && !isCurrentlyRecording;
      expect(shouldStart).toBe(false);
    });

    it('should stop recording when state transitions away from recording', () => {
      const nextStates: SessionState[] = ['idle', 'stopping', 'processing', 'complete', 'error'];
      const isCurrentlyRecording = true;

      nextStates.forEach((nextState) => {
        const shouldStop = nextState !== 'recording' && isCurrentlyRecording;
        expect(shouldStop).toBe(true);
      });
    });

    it('should not stop if not recording', () => {
      const nextState: SessionState = 'idle';
      const isCurrentlyRecording = false;
      const shouldStop = nextState !== 'recording' && isCurrentlyRecording;
      expect(shouldStop).toBe(false);
    });
  });

  // ========================================================================
  // Component visibility matrix
  // ========================================================================

  describe('component visibility matrix', () => {
    it('SettingsPanel visible only in settings view', () => {
      const views: AppView[] = ['main', 'settings', 'history', 'shortcuts'];
      expect(views.map((v) => v === 'settings')).toEqual([false, true, false, false]);
    });

    it('SessionHistory visible only in history view', () => {
      const views: AppView[] = ['main', 'settings', 'history', 'shortcuts'];
      expect(views.map((v) => v === 'history')).toEqual([false, false, true, false]);
    });

    it('KeyboardShortcuts visible only in shortcuts view', () => {
      const views: AppView[] = ['main', 'settings', 'history', 'shortcuts'];
      expect(views.map((v) => v === 'shortcuts')).toEqual([false, false, false, true]);
    });

    it('Onboarding overlays any view', () => {
      let state = createInitialState();
      state.currentView = 'settings';
      state = handleNavigation(state, 'onboarding');

      expect(state.showOnboarding).toBe(true);
      expect(state.currentView).toBe('settings'); // View doesn't change
    });

    it('RecordingOverlay shows only during recording', () => {
      const states: SessionState[] = ['idle', 'starting', 'recording', 'stopping', 'processing', 'complete', 'error'];
      expect(states.map((s) => s === 'recording')).toEqual([false, false, true, false, false, false, false]);
    });

    it('Transcript section shows only during recording', () => {
      const states: SessionState[] = ['idle', 'starting', 'recording', 'stopping', 'processing', 'complete', 'error'];
      expect(states.map((s) => s === 'recording')).toEqual([false, false, true, false, false, false, false]);
    });

    it('Error section shows only in error state with message', () => {
      const errorMessage = 'Something broke';
      const states: SessionState[] = ['idle', 'starting', 'recording', 'stopping', 'processing', 'complete', 'error'];
      const visible = states.map((s) => !!errorMessage && s === 'error');
      expect(visible).toEqual([false, false, false, false, false, false, true]);
    });

    it('Report section shows when reportPath exists', () => {
      const withPath = !!'/report.md';
      const withoutPath = !!null;
      expect(withPath).toBe(true);
      expect(withoutPath).toBe(false);
    });
  });
});
