/**
 * UIContext
 *
 * Manages UI navigation state, app settings, derived display values,
 * and navigation IPC listeners from the main process menu/tray.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSettings, SessionState } from '../../shared/types';
import { useRecording } from './RecordingContext';
import { useProcessing } from './ProcessingContext';

// ============================================================================
// Types
// ============================================================================

export type AppView = 'main' | 'settings' | 'history' | 'shortcuts';

export interface UIContextValue {
  // Navigation
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  closeOverlay: () => void;

  // Dialog state
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
  showCountdown: boolean;
  setShowCountdown: (show: boolean) => void;
  showExportDialog: boolean;
  setShowExportDialog: (show: boolean) => void;

  // Settings
  settings: AppSettings | null;
  hasRequiredByokKeys: boolean | null;
  countdownDuration: number;

  // Derived state
  isHudMode: boolean;
  showRecordingStatus: boolean;
  showProcessingProgress: boolean;
  statusCopy: { title: string; detail: string };
  primaryActionLabel: string;
  primaryActionDisabled: boolean;
  pauseActionDisabled: boolean;
  manualCaptureDisabled: boolean;

  // Handlers
  handleOnboardingComplete: () => void;
  handleOnboardingSkip: () => void;
  handleExport: (options: { format: string; projectName: string; includeImages: boolean; theme: string }) => Promise<void>;
}

const UIContext = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used within UIProvider');
  }
  return context;
}

// ============================================================================
// Helpers
// ============================================================================

function mapPopoverState(state: SessionState): 'idle' | 'recording' | 'processing' | 'complete' | 'error' {
  if (state === 'recording' || state === 'starting') return 'recording';
  if (state === 'stopping' || state === 'processing') return 'processing';
  if (state === 'complete') return 'complete';
  if (state === 'error') return 'error';
  return 'idle';
}

function mapOverlaySize(view: AppView): { width: number; height: number } {
  switch (view) {
    case 'settings':
      return { width: 920, height: 760 };
    case 'history':
      return { width: 920, height: 760 };
    case 'shortcuts':
      return { width: 720, height: 720 };
    default:
      return { width: 0, height: 0 };
  }
}

// ============================================================================
// Provider
// ============================================================================

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const recording = useRecording();
  const processing = useProcessing();

  // ---------------------------------------------------------------------------
  // Navigation state
  // ---------------------------------------------------------------------------
  const [currentView, setCurrentView] = useState<AppView>('main');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasRequiredByokKeys, setHasRequiredByokKeys] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadInitialSettings = async () => {
      try {
        const loadedSettings = await window.markupr.settings.getAll();
        if (mounted) setSettings(loadedSettings);
      } catch {
        // Settings load failure is non-fatal
      }

      try {
        const [hasOpenAiKey, hasAnthropicKey] = await Promise.all([
          window.markupr.settings.hasApiKey('openai'),
          window.markupr.settings.hasApiKey('anthropic'),
        ]);
        if (mounted) setHasRequiredByokKeys(hasOpenAiKey && hasAnthropicKey);
      } catch {
        if (mounted) setHasRequiredByokKeys(false);
      }
    };

    void loadInitialSettings();

    return () => {
      mounted = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Navigation event listeners (from main process menu/tray)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const nav = window.markupr.navigation;
    if (!nav) return;

    const unsubSettings = nav.onShowSettings(() => setCurrentView('settings'));
    const unsubHistory = nav.onShowHistory(() => setCurrentView('history'));
    const unsubShortcuts = nav.onShowShortcuts(() => setCurrentView('shortcuts'));
    const unsubOnboarding = nav.onShowOnboarding(() => setShowOnboarding(true));
    const unsubExport = nav.onShowExport(() => setShowExportDialog(true));

    return () => {
      unsubSettings();
      unsubHistory();
      unsubShortcuts();
      unsubOnboarding();
      unsubExport();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Dismiss overlays when recording starts (driven by recording state)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (recording.state === 'recording') {
      setCurrentView('main');
      setShowCountdown(false);
    }
  }, [recording.state]);

  // ---------------------------------------------------------------------------
  // Popover resize on state/view change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (currentView !== 'main') {
      const { width, height } = mapOverlaySize(currentView);
      window.markupr.popover.resize(width, height).catch(() => {});
      return;
    }

    window.markupr.popover.resizeToState(mapPopoverState(recording.state)).catch(() => {});
  }, [recording.state, currentView]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const showRecordingStatus = recording.state === 'recording';
  const showProcessingProgress = recording.state === 'stopping' || recording.state === 'processing';
  const isHudMode = (showRecordingStatus || showProcessingProgress) && currentView === 'main';
  const countdownDuration = settings?.defaultCountdown ?? 0;

  const primaryActionLabel = recording.state === 'recording' ? 'Stop Session' : 'Start Session';
  const primaryActionDisabled =
    recording.isMutating ||
    recording.state === 'starting' ||
    recording.state === 'stopping' ||
    recording.state === 'processing';
  const pauseActionDisabled = recording.isMutating || recording.state !== 'recording';
  const manualCaptureDisabled = recording.isMutating || recording.state !== 'recording' || recording.isPaused;

  const statusCopy = useMemo(() => {
    switch (recording.state) {
      case 'starting':
        return {
          title: 'Preparing Session',
          detail: 'Initializing microphone capture and session recording.',
        };
      case 'recording':
        return {
          title: 'Recording Live',
          detail: recording.isPaused
            ? 'Session paused. Resume to continue capturing screen and narration.'
            : 'Speak while testing. Transcript is generated after you stop recording.',
        };
      case 'stopping':
      case 'processing':
        return {
          title: 'Processing Your Recording',
          detail: processing.processingProgress?.step || 'Preparing post-processing pipeline...',
        };
      case 'complete':
        return {
          title: 'Report Ready',
          detail: 'Markdown path copied to your clipboard.',
        };
      case 'error':
        return {
          title: 'Session Error',
          detail: recording.errorMessage || 'An unexpected error interrupted this capture.',
        };
      default:
        return {
          title: 'Ready To Capture',
          detail:
            recording.hasTranscriptionCapability === false
              ? 'Recording works now. Add an OpenAI API key (or a local Whisper model) for automatic transcript generation after stop.'
              : 'Press Cmd+Shift+F to start a fresh feedback pass.',
        };
    }
  }, [recording.state, recording.errorMessage, recording.hasTranscriptionCapability, recording.isPaused, processing.processingProgress]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const closeOverlay = useCallback(() => {
    setCurrentView('main');
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    window.markupr.setSettings({ hasCompletedOnboarding: true }).catch(() => {});
    window.markupr.whisper
      .hasTranscriptionCapability()
      .then(() => {})
      .catch(() => {});
  }, []);

  const handleOnboardingSkip = useCallback(() => {
    setShowOnboarding(false);
    window.markupr.setSettings({ hasCompletedOnboarding: true }).catch(() => {});
  }, []);

  const handleExport = useCallback(async (_options: { format: string; projectName: string; includeImages: boolean; theme: string }) => {
    setShowExportDialog(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------
  const value = useMemo(
    (): UIContextValue => ({
      currentView,
      setCurrentView,
      closeOverlay,
      showOnboarding,
      setShowOnboarding,
      showCountdown,
      setShowCountdown,
      showExportDialog,
      setShowExportDialog,
      settings,
      hasRequiredByokKeys,
      countdownDuration,
      isHudMode,
      showRecordingStatus,
      showProcessingProgress,
      statusCopy,
      primaryActionLabel,
      primaryActionDisabled,
      pauseActionDisabled,
      manualCaptureDisabled,
      handleOnboardingComplete,
      handleOnboardingSkip,
      handleExport,
    }),
    [
      currentView,
      closeOverlay,
      showOnboarding,
      showCountdown,
      showExportDialog,
      settings,
      hasRequiredByokKeys,
      countdownDuration,
      isHudMode,
      showRecordingStatus,
      showProcessingProgress,
      statusCopy,
      primaryActionLabel,
      primaryActionDisabled,
      pauseActionDisabled,
      manualCaptureDisabled,
      handleOnboardingComplete,
      handleOnboardingSkip,
      handleExport,
    ]
  );

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
};

export default UIContext;
