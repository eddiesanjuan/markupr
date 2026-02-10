import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionPayload, SessionState, AppSettings, ReviewSession } from '../shared/types';
import { getScreenRecordingRenderer } from './capture/ScreenRecordingRenderer';
import {
  CrashRecoveryDialog,
  useCrashRecovery,
  Onboarding,
  SettingsPanel,
  UpdateNotification,
  CountdownTimer,
  CompactAudioIndicator,
  DonateButton,
  KeyboardShortcuts,
  ExportDialog,
  SessionReview,
  RecordingOverlay,
} from './components';
import { SessionHistory } from './components/SessionHistory';
import { ToggleRecordingHint, ManualScreenshotHint, PauseResumeHint } from './components/HotkeyHint';
import StatusIndicator from './components/StatusIndicator';
import './styles/app-shell.css';

// ============================================================================
// Post-processing progress types
// ============================================================================

interface ProcessingProgress {
  percent: number;
  step: string;
}

const PROCESSING_BASELINE_PERCENT = 4;
const PROCESSING_VISIBLE_MAX = 96;
const PROCESSING_PROGRESS_TICK_MS = 120;
const PROCESSING_DOT_FRAMES = ['∙∙∙', '●∙∙', '●●∙', '●●●'] as const;

const PROCESSING_STEP_LABELS: Record<string, string> = {
  preparing: 'Finalizing recording assets...',
  transcribing: 'Transcribing narration...',
  analyzing: 'Analyzing spoken context...',
  saving: 'Saving session artifacts...',
  'extracting-frames': 'Extracting key visual frames...',
  'generating-report': 'Generating markdown report...',
  complete: 'Finalizing output files...',
};

const PROCESSING_STEP_TARGETS: Record<string, number> = {
  preparing: 28,
  transcribing: 58,
  analyzing: 72,
  saving: 82,
  'extracting-frames': 90,
  'generating-report': PROCESSING_VISIBLE_MAX,
  complete: PROCESSING_VISIBLE_MAX,
};

function normalizeProcessingStep(step?: string): string {
  if (!step) return 'preparing';
  return step.toLowerCase();
}

function formatProcessingStep(step?: string): string {
  const normalized = normalizeProcessingStep(step);
  return PROCESSING_STEP_LABELS[normalized] || 'Finalizing report output...';
}

function resolveProcessingStageTarget(step?: string): number {
  const normalized = normalizeProcessingStep(step);
  return PROCESSING_STEP_TARGETS[normalized] ?? 88;
}

// ============================================================================
// Types
// ============================================================================

interface RecentSession {
  id: string;
  startTime: number;
  endTime: number;
  itemCount: number;
  screenshotCount: number;
  sourceName: string;
  firstThumbnail?: string;
  folder: string;
  transcriptionPreview?: string;
}

interface LastCapture {
  trigger?: 'pause' | 'manual' | 'voice-command';
  timestamp: number;
}

type AppView = 'main' | 'settings' | 'history' | 'shortcuts';

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function formatCaptureTrigger(trigger?: LastCapture['trigger']): string {
  switch (trigger) {
    case 'manual':
      return 'Manual Capture';
    case 'voice-command':
      return 'Voice Cue Capture';
    default:
      return 'Auto Pause Capture';
  }
}

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
// App Component
// ============================================================================

const App: React.FC = () => {
  // ---------------------------------------------------------------------------
  // Session state (existing)
  // ---------------------------------------------------------------------------
  const [state, setState] = useState<SessionState>('idle');
  const [duration, setDuration] = useState(0);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [sessionDir, setSessionDir] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasTranscriptionCapability, setHasTranscriptionCapability] = useState<boolean | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [lastCapture, setLastCapture] = useState<LastCapture | null>(null);
  const screenRecorderRef = useRef(getScreenRecordingRenderer());

  // ---------------------------------------------------------------------------
  // View state (new)
  // ---------------------------------------------------------------------------
  const [currentView, setCurrentView] = useState<AppView>('main');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showReviewEditor, setShowReviewEditor] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [rawProcessingProgress, setRawProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [processingDotFrame, setProcessingDotFrame] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasRequiredByokKeys, setHasRequiredByokKeys] = useState<boolean | null>(null);
  const outputReadyRef = useRef(false);
  const processingStartedAtRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Crash recovery (existing)
  // ---------------------------------------------------------------------------
  const {
    incompleteSession,
    isCheckingRecovery,
    recoverSession,
    discardSession,
  } = useCrashRecovery();

  // ---------------------------------------------------------------------------
  // Load settings once on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    const loadInitialSettings = async () => {
      try {
        const loadedSettings = await window.markupr.settings.getAll();
        if (mounted) {
          setSettings(loadedSettings);
        }
      } catch {
        // Settings load failure is non-fatal
      }

      try {
        const [hasOpenAiKey, hasAnthropicKey] = await Promise.all([
          window.markupr.settings.hasApiKey('openai'),
          window.markupr.settings.hasApiKey('anthropic'),
        ]);
        if (mounted) {
          setHasRequiredByokKeys(hasOpenAiKey && hasAnthropicKey);
        }
      } catch {
        if (mounted) {
          setHasRequiredByokKeys(false);
        }
      }
    };

    void loadInitialSettings();

    return () => {
      mounted = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Recent sessions (existing)
  // ---------------------------------------------------------------------------
  const loadRecentSessions = useCallback(async () => {
    try {
      if (!window.markupr?.output?.listSessions) {
        setRecentSessions([]);
        return;
      }
      const sessions = await window.markupr.output.listSessions();
      setRecentSessions(sessions.slice(0, 5));
    } catch (error) {
      console.error('[App] Failed to load recent sessions:', error);
      setRecentSessions([]);
    }
  }, []);

  useEffect(() => {
    loadRecentSessions();
  }, [loadRecentSessions]);

  // ---------------------------------------------------------------------------
  // Transcription capability check (existing)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    window.markupr.whisper
      .hasTranscriptionCapability()
      .then((ready) => {
        setHasTranscriptionCapability(ready);
      })
      .catch(() => {
        setHasTranscriptionCapability(false);
      });
  }, []);

  // ---------------------------------------------------------------------------
  // Screen recording sync (existing)
  // ---------------------------------------------------------------------------
  const syncScreenRecording = useCallback(
    async (nextState: SessionState, session: SessionPayload | null, paused: boolean) => {
      const recorder = screenRecorderRef.current;

      if (nextState === 'recording') {
        if (stopRequestedRef.current) {
          if (recorder.isRecording() || recorder.getSessionId()) {
            await recorder.stop().catch((error) => {
              console.warn('[App] Forced recorder stop during stop-request guard failed:', error);
            });
          }
          return;
        }

        if (!recorder.isRecording()) {
          let activeSession = session;
          if (!activeSession) {
            for (let attempt = 0; attempt < 4; attempt += 1) {
              activeSession = await window.markupr.session.getCurrent();
              if (activeSession) {
                break;
              }
              if (attempt < 3) {
                await new Promise((resolve) => setTimeout(resolve, 180));
              }
            }
          }

          if (!activeSession) {
            setErrorMessage((prev) => prev || 'Session started, but screen recorder could not find an active capture target.');
            return;
          }

          try {
            await recorder.start({
              sessionId: activeSession.id,
              sourceId: activeSession.sourceId,
            });
          } catch (error) {
            console.warn('[App] Continuous screen recording failed to start with primary source:', error);

            try {
              const sources = await window.markupr.capture.getSources();
              const fallbackSource = sources.find((source) => source.type === 'screen');

              if (!fallbackSource || fallbackSource.id === activeSession.sourceId) {
                throw error;
              }

              await recorder.start({
                sessionId: activeSession.id,
                sourceId: fallbackSource.id,
              });
            } catch (fallbackError) {
              const message =
                fallbackError instanceof Error
                  ? fallbackError.message
                  : 'Unknown screen recording error.';
              console.warn('[App] Continuous screen recording fallback also failed:', message);
              setErrorMessage((prev) => prev || `Screen recording unavailable: ${message}`);
              return;
            }
          }
        }

        if (paused) {
          await recorder.pause();
        } else {
          await recorder.resume();
        }
        return;
      }

      if (recorder.isRecording() || recorder.getSessionId()) {
        await recorder.stop().catch((error) => {
          console.warn('[App] Failed to stop continuous screen recording:', error);
        });
      }
      recorder.forceReleaseOrphanedCapture();
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Session IPC listeners (existing)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    const recorder = screenRecorderRef.current;

    window.markupr.session
      .getStatus()
      .then((status) => {
        if (!mounted) return;
        setState(status.state);
        setDuration(status.duration);
        setScreenshotCount(status.screenshotCount);
        setIsPaused(status.isPaused);
        void syncScreenRecording(status.state, null, status.isPaused);
      })
      .catch((error) => {
        console.error('[App] Failed to load initial status:', error);
      });

    const toUiState = (nextState: SessionState): SessionState =>
      nextState === 'complete' && !outputReadyRef.current ? 'processing' : nextState;

    const unsubState = window.markupr.session.onStateChange(({ state: nextState, session }) => {
      const effectiveState =
        stopRequestedRef.current && nextState === 'recording' ? 'stopping' : nextState;
      setState(toUiState(effectiveState));
      void syncScreenRecording(effectiveState, session, false);
      if (nextState === 'recording') {
        stopRequestedRef.current = false;
        outputReadyRef.current = false;
        setErrorMessage(null);
        setReportPath(null);
        setRecordingPath(null);
        setAudioPath(null);
        setSessionDir(null);
        setReviewSession(null);
        setShowReviewEditor(false);
        setProcessingProgress(null);
        setRawProcessingProgress(null);
        processingStartedAtRef.current = null;
        // Dismiss overlays when recording starts
        setCurrentView('main');
        setShowCountdown(false);
        setIsPaused(false);
      }
      if (nextState === 'stopping' || nextState === 'processing') {
        if (!processingStartedAtRef.current) {
          processingStartedAtRef.current = Date.now();
        }
        setRawProcessingProgress((previous) => previous ?? { percent: 0, step: 'preparing' });
        setProcessingProgress((previous) =>
          previous ?? {
            percent: PROCESSING_BASELINE_PERCENT,
            step: formatProcessingStep('preparing'),
          }
        );
      }
      if (nextState === 'idle') {
        stopRequestedRef.current = false;
        outputReadyRef.current = false;
        setDuration(0);
        setProcessingProgress(null);
        setRawProcessingProgress(null);
        processingStartedAtRef.current = null;
        setIsPaused(false);
      }
    });

    const unsubStatus = window.markupr.session.onStatusUpdate((status) => {
      const effectiveState =
        stopRequestedRef.current && status.state === 'recording' ? 'stopping' : status.state;
      setDuration(status.duration);
      setScreenshotCount(status.screenshotCount);
      setState(toUiState(effectiveState));
      setIsPaused(status.isPaused);
      void syncScreenRecording(effectiveState, null, status.isPaused);
    });

    const unsubScreenshot = window.markupr.capture.onScreenshot((payload) => {
      setScreenshotCount(payload.count);
      setLastCapture({
        trigger: payload.trigger,
        timestamp: payload.timestamp,
      });
    });

    const unsubReady = window.markupr.output.onReady((payload) => {
      void syncScreenRecording('idle', null, false).catch((error) => {
        console.warn('[App] Failed to force-release screen recorder on output ready:', error);
      });
      stopRequestedRef.current = false;
      outputReadyRef.current = true;
      setRawProcessingProgress({ percent: 100, step: 'complete' });
      setProcessingProgress({ percent: 100, step: formatProcessingStep('complete') });
      setState('complete');
      setErrorMessage(null);
      setReportPath(payload.path || payload.reportPath || null);
      setRecordingPath(payload.recordingPath || null);
      setAudioPath(payload.audioPath || null);
      setSessionDir(payload.sessionDir || null);
      setReviewSession(payload.reviewSession || null);
      setShowReviewEditor(false);
      setDuration(0);
      loadRecentSessions();
      processingStartedAtRef.current = null;
    });

    const unsubSessionError = window.markupr.session.onError((payload) => {
      stopRequestedRef.current = false;
      outputReadyRef.current = false;
      setState('error');
      setErrorMessage(payload.message);
    });

    const unsubOutputError = window.markupr.output.onError((payload) => {
      stopRequestedRef.current = false;
      outputReadyRef.current = false;
      setState('error');
      setErrorMessage(payload.message);
    });

    return () => {
      mounted = false;
      unsubState();
      unsubStatus();
      unsubScreenshot();
      unsubReady();
      unsubSessionError();
      unsubOutputError();

      if (recorder.isRecording()) {
        void recorder.stop();
      }
    };
  }, [loadRecentSessions, syncScreenRecording]);

  // ---------------------------------------------------------------------------
  // Audio level + voice activity listeners (for CompactAudioIndicator)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsubLevel = window.markupr.audio.onLevel((level) => {
      setAudioLevel(level);
    });
    const unsubVoice = window.markupr.audio.onVoiceActivity((active) => {
      setIsVoiceActive(active);
    });
    const unsubSessionVoice = window.markupr.session.onVoiceActivity(({ active }) => {
      setIsVoiceActive(active);
    });

    return () => {
      unsubLevel();
      unsubVoice();
      unsubSessionVoice();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Post-processing progress listeners
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Subscribe to post-processing updates emitted from main via preload bridge.
    const markuprApi = window.markupr as Record<string, unknown>;
    let unsubProgress: (() => void) | null = null;
    let unsubComplete: (() => void) | null = null;

    if (markuprApi.processing && typeof (markuprApi.processing as Record<string, unknown>).onProgress === 'function') {
      const processingApi = markuprApi.processing as {
        onProgress: (cb: (data: ProcessingProgress) => void) => () => void;
        onComplete: (cb: (data: unknown) => void) => () => void;
      };
      unsubProgress = processingApi.onProgress((data) => {
        setRawProcessingProgress({
          percent: Math.max(0, Math.min(100, Math.round(data.percent))),
          step: data.step,
        });
      });
      unsubComplete = processingApi.onComplete(() => {
        setRawProcessingProgress({ percent: 100, step: 'complete' });
      });
    }

    return () => {
      unsubProgress?.();
      unsubComplete?.();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Processing progress smoothing (keeps UX believable and avoids instant jumps)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const isProcessingState = state === 'stopping' || state === 'processing';
    if (!isProcessingState) {
      return;
    }

    if (!processingStartedAtRef.current) {
      processingStartedAtRef.current = Date.now();
    }

    const interval = window.setInterval(() => {
      const startedAt = processingStartedAtRef.current ?? Date.now();
      const elapsedMs = Date.now() - startedAt;
      const elapsedFloor = (() => {
        if (elapsedMs < 2200) {
          return PROCESSING_BASELINE_PERCENT + elapsedMs / 120;
        }
        if (elapsedMs < 9000) {
          return 22 + (elapsedMs - 2200) / 170;
        }
        if (elapsedMs < 22000) {
          return 62 + (elapsedMs - 9000) / 420;
        }
        return 85 + (elapsedMs - 22000) / 1300;
      })();
      const rawPercent = Math.max(0, Math.min(100, rawProcessingProgress?.percent ?? 0));
      const rawGuided = Math.min(PROCESSING_VISIBLE_MAX, rawPercent + 8);
      const stageTarget = resolveProcessingStageTarget(rawProcessingProgress?.step);
      const targetPercent = Math.max(
        PROCESSING_BASELINE_PERCENT,
        Math.min(PROCESSING_VISIBLE_MAX, Math.max(elapsedFloor, rawGuided, stageTarget))
      );
      const stepLabel = formatProcessingStep(rawProcessingProgress?.step);

      setProcessingProgress((previous) => {
        const currentPercent = previous?.percent ?? PROCESSING_BASELINE_PERCENT;
        const delta = targetPercent - currentPercent;
        const nextPercent =
          delta <= 0.25
            ? targetPercent
            : currentPercent + Math.max(0.3, delta * 0.16);

        return {
          percent: Math.round(Math.min(PROCESSING_VISIBLE_MAX, nextPercent)),
          step: stepLabel,
        };
      });
    }, PROCESSING_PROGRESS_TICK_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [state, rawProcessingProgress]);

  useEffect(() => {
    const isProcessingState = state === 'stopping' || state === 'processing';
    if (!isProcessingState) {
      setProcessingDotFrame(0);
      return;
    }

    const interval = window.setInterval(() => {
      setProcessingDotFrame((prev) => (prev + 1) % 4);
    }, 360);

    return () => {
      window.clearInterval(interval);
    };
  }, [state]);

  // ---------------------------------------------------------------------------
  // Navigation event listeners (new - from main process menu/tray)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const nav = window.markupr.navigation;
    if (!nav) return;

    const unsubSettings = nav.onShowSettings(() => {
      setCurrentView('settings');
    });
    const unsubHistory = nav.onShowHistory(() => {
      setCurrentView('history');
    });
    const unsubShortcuts = nav.onShowShortcuts(() => {
      setCurrentView('shortcuts');
    });
    const unsubOnboarding = nav.onShowOnboarding(() => {
      setShowOnboarding(true);
    });
    const unsubExport = nav.onShowExport(() => {
      setShowExportDialog(true);
    });

    return () => {
      unsubSettings();
      unsubHistory();
      unsubShortcuts();
      unsubOnboarding();
      unsubExport();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Popover resize on state/view change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (currentView !== 'main') {
      const { width, height } = mapOverlaySize(currentView);
      window.markupr.popover.resize(width, height).catch(() => {
        // Popover controls are optional in non-popover mode.
      });
      return;
    }

    window.markupr.popover.resizeToState(mapPopoverState(state)).catch(() => {
      // Popover controls are optional in non-popover mode.
    });
  }, [state, currentView]);

  // ---------------------------------------------------------------------------
  // Status copy text (existing)
  // ---------------------------------------------------------------------------
  const statusCopy = useMemo(() => {
    switch (state) {
      case 'starting':
        return {
          title: 'Preparing Session',
          detail: 'Initializing microphone capture and session recording.',
        };
      case 'recording':
        return {
          title: 'Recording Live',
          detail: isPaused
            ? 'Session paused. Resume to continue capturing screen and narration.'
            : 'Speak while testing. Transcript is generated after you stop recording.',
        };
      case 'stopping':
      case 'processing':
        return {
          title: 'Processing Your Recording',
          detail: processingProgress?.step || 'Preparing post-processing pipeline...',
        };
      case 'complete':
        return {
          title: 'Report Ready',
          detail: 'Markdown path copied to your clipboard.',
        };
      case 'error':
        return {
          title: 'Session Error',
          detail: errorMessage || 'An unexpected error interrupted this capture.',
        };
      default:
        return {
          title: 'Ready To Capture',
          detail:
            hasTranscriptionCapability === false
              ? 'Recording works now. Add an OpenAI API key (or a local Whisper model) for automatic transcript generation after stop.'
              : 'Press Cmd+Shift+F to start a fresh feedback pass.',
        };
    }
  }, [state, errorMessage, hasTranscriptionCapability, isPaused, processingProgress]);

  // ---------------------------------------------------------------------------
  // Derived state (existing)
  // ---------------------------------------------------------------------------
  const primaryActionLabel = state === 'recording' ? 'Stop Session' : 'Start Session';
  const primaryActionDisabled = isMutating || state === 'starting' || state === 'stopping' || state === 'processing';
  const pauseActionDisabled = isMutating || state !== 'recording';
  const manualCaptureDisabled = isMutating || state !== 'recording' || isPaused;
  const showRecordingStatus = state === 'recording';
  const showProcessingProgress = state === 'stopping' || state === 'processing';
  const isRecordingHudMode = showRecordingStatus && currentView === 'main';

  useEffect(() => {
    const bodyClass = 'markupr-hud-mode';
    const htmlClass = 'markupr-hud-mode';
    document.documentElement.classList.toggle(htmlClass, isRecordingHudMode);
    document.body.classList.toggle(bodyClass, isRecordingHudMode);
    return () => {
      document.documentElement.classList.remove(htmlClass);
      document.body.classList.remove(bodyClass);
    };
  }, [isRecordingHudMode]);

  const countdownDuration = settings?.defaultCountdown ?? 0;
  // ---------------------------------------------------------------------------
  // Handlers (existing, with countdown integration)
  // ---------------------------------------------------------------------------
  const handlePrimaryAction = useCallback(async () => {
    if (primaryActionDisabled) return;

    // If idle and countdown is configured, show countdown first
    if (state === 'idle' && countdownDuration > 0) {
      setShowCountdown(true);
      return;
    }

    setIsMutating(true);
    try {
      if (state === 'recording') {
        stopRequestedRef.current = true;
        // Flush renderer-side screen recorder first so main-process post-processing
        // receives a finalized video artifact.
        try {
          await syncScreenRecording('idle', null, false);
        } catch (error) {
          console.warn('[App] Failed to flush screen recording before stop:', error);
        }

        const result = await window.markupr.session.stop();
        if (!result.success) {
          setState('error');
          setErrorMessage(result.error || 'Unable to stop session.');
        }
        return;
      }

      setScreenshotCount(0);
      setLastCapture(null);
      setRecordingPath(null);
      setAudioPath(null);
      setErrorMessage(null);
      stopRequestedRef.current = false;
      outputReadyRef.current = false;

      const result = await window.markupr.session.start();
      if (!result.success) {
        setState('error');
        setErrorMessage(result.error || 'Unable to start session.');
        window.markupr.whisper
          .hasTranscriptionCapability()
          .then((ready) => setHasTranscriptionCapability(ready))
          .catch(() => {
            // Keep previous badge state when status refresh fails.
          });
      } else {
        const activeSession = await window.markupr.session.getCurrent();
        if (activeSession) {
          await syncScreenRecording('recording', activeSession, false);
        }
      }
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown session error.');
    } finally {
      setIsMutating(false);
    }
  }, [primaryActionDisabled, state, countdownDuration, syncScreenRecording]);

  const handleCountdownComplete = useCallback(async () => {
    setShowCountdown(false);
    setIsMutating(true);
    try {
      setScreenshotCount(0);
      setLastCapture(null);
      setRecordingPath(null);
      setAudioPath(null);
      setErrorMessage(null);
      stopRequestedRef.current = false;
      outputReadyRef.current = false;

      const result = await window.markupr.session.start();
      if (!result.success) {
        setState('error');
        setErrorMessage(result.error || 'Unable to start session.');
      } else {
        const activeSession = await window.markupr.session.getCurrent();
        if (activeSession) {
          await syncScreenRecording('recording', activeSession, false);
        }
      }
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown session error.');
    } finally {
      setIsMutating(false);
    }
  }, [syncScreenRecording]);

  const handlePauseAction = useCallback(async () => {
    if (pauseActionDisabled) return;

    setIsMutating(true);
    try {
      if (isPaused) {
        const result = await window.markupr.session.resume();
        if (!result.success) {
          setErrorMessage(result.error || 'Unable to resume session.');
          return;
        }
        setIsPaused(false);
        await syncScreenRecording('recording', null, false);
        return;
      }

      const result = await window.markupr.session.pause();
      if (!result.success) {
        setErrorMessage(result.error || 'Unable to pause session.');
        return;
      }
      setIsPaused(true);
      setIsVoiceActive(false);
      await syncScreenRecording('recording', null, true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Pause/resume failed.');
    } finally {
      setIsMutating(false);
    }
  }, [isPaused, pauseActionDisabled, syncScreenRecording]);

  const handleCountdownSkip = useCallback(() => {
    setShowCountdown(false);
  }, []);

  const handleManualCapture = useCallback(async () => {
    if (manualCaptureDisabled) return;
    const result = await window.markupr.capture.manualScreenshot();
    if (!result.success) {
      setErrorMessage('Manual capture failed.');
    }
  }, [manualCaptureDisabled]);

  const handleCopyReportPath = useCallback(async () => {
    if (!reportPath) return;
    await window.markupr.copyToClipboard(reportPath);
  }, [reportPath]);

  const handleOpenReportFolder = useCallback(async () => {
    if (sessionDir) {
      await window.markupr.output.openFolder(sessionDir);
      return;
    }
    if (reportPath) {
      await window.markupr.output.openFolder(reportPath);
    }
  }, [sessionDir, reportPath]);

  const handleCopyRecordingPath = useCallback(async () => {
    if (!recordingPath) return;
    await window.markupr.copyToClipboard(recordingPath);
  }, [recordingPath]);

  const handleCopyAudioPath = useCallback(async () => {
    if (!audioPath) return;
    await window.markupr.copyToClipboard(audioPath);
  }, [audioPath]);

  const handleOpenRecent = useCallback(async (session: RecentSession) => {
    await window.markupr.output.openFolder(session.folder);
  }, []);

  const handleCopyRecentPath = useCallback(async (session: RecentSession) => {
    await window.markupr.copyToClipboard(`${session.folder}/feedback-report.md`);
  }, []);

  const handleRecoverSession = useCallback(() => {
    recoverSession();
    outputReadyRef.current = true;
    setState('complete');
    loadRecentSessions();
  }, [recoverSession, loadRecentSessions]);

  const handleDiscardSession = useCallback(() => {
    discardSession();
  }, [discardSession]);

  // ---------------------------------------------------------------------------
  // New view handlers
  // ---------------------------------------------------------------------------
  const handleCloseOverlay = useCallback(() => {
    setCurrentView('main');
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    // Refresh transcription capability after onboarding
    window.markupr.whisper
      .hasTranscriptionCapability()
      .then((ready) => setHasTranscriptionCapability(ready))
      .catch(() => {});
  }, []);

  const handleOnboardingSkip = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  const handleOpenSession = useCallback(async (session: { folder: string }) => {
    await window.markupr.output.openFolder(session.folder);
  }, []);

  const handleExport = useCallback(async () => {
    // No-op for now; the ExportDialog handles its own export logic.
    setShowExportDialog(false);
  }, []);

  const handleReviewSave = useCallback(async (_session: ReviewSession) => {
    // Save edited session back to main process
    try {
      await window.markupr.output.save();
    } catch {
      // Save failure is non-fatal in review mode
    }
  }, []);

  const handleReviewClose = useCallback(() => {
    setShowReviewEditor(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={`ff-shell ff-shell--${state}${isRecordingHudMode ? ' ff-shell--hud' : ''}`}>
      {/* === Global overlays (always rendered, self-manage visibility) === */}
      <UpdateNotification />

      {/* === Crash Recovery Dialog === */}
      {incompleteSession && !isCheckingRecovery && (
        <CrashRecoveryDialog
          session={incompleteSession}
          onRecover={handleRecoverSession}
          onDiscard={handleDiscardSession}
        />
      )}

      {/* === Onboarding (full-screen overlay) === */}
      {showOnboarding && (
        <Onboarding
          onComplete={handleOnboardingComplete}
          onSkip={handleOnboardingSkip}
        />
      )}

      {/* === Countdown Timer (full-screen overlay) === */}
      {showCountdown && countdownDuration > 0 && (
        <CountdownTimer
          duration={countdownDuration as 3 | 5}
          onComplete={handleCountdownComplete}
          onSkip={handleCountdownSkip}
        />
      )}

      {/* === Settings Panel (overlay) === */}
      <SettingsPanel
        isOpen={currentView === 'settings'}
        onClose={handleCloseOverlay}
      />

      {/* === Session History (overlay) === */}
      <SessionHistory
        isOpen={currentView === 'history'}
        onClose={handleCloseOverlay}
        onOpenSession={handleOpenSession}
      />

      {/* === Keyboard Shortcuts (overlay) === */}
      <KeyboardShortcuts
        isOpen={currentView === 'shortcuts'}
        onClose={handleCloseOverlay}
      />

      {/* === Export Dialog (overlay, shown when triggered from menu) === */}
      {showExportDialog && (
        <ExportDialog
          session={{ id: '', startTime: Date.now(), feedbackItems: [] }}
          isOpen={showExportDialog}
          onClose={() => setShowExportDialog(false)}
          onExport={handleExport}
        />
      )}

      {/* === Main Card === */}
      <main className={`ff-shell__card${isRecordingHudMode ? ' ff-shell__card--hud' : ''}`}>
        {showRecordingStatus && (
          <RecordingOverlay
            duration={Math.floor(duration / 1000)}
            screenshotCount={screenshotCount}
            onStop={() => {
              void handlePrimaryAction();
            }}
            audioLevel={audioLevel}
            isVoiceActive={isVoiceActive}
            manualShortcut={settings?.hotkeys?.manualScreenshot}
            toggleShortcut={settings?.hotkeys?.toggleRecording}
            pauseShortcut={settings?.hotkeys?.pauseResume}
          />
        )}

        {!isRecordingHudMode && (
          <>
        <header className="ff-shell__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusIndicator
              status={mapPopoverState(state)}
              error={errorMessage}
            />
            <div>
              <p className="ff-shell__eyebrow">markupr</p>
              <h1 className="ff-shell__title">{statusCopy.title}</h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="ff-shell__quiet-btn"
              onClick={() => setCurrentView('settings')}
              type="button"
              aria-label="Open Settings"
              title="Settings"
              style={{ fontSize: 16 }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" />
                <path d="M13.178 9.689a1.2 1.2 0 00.24 1.324l.043.044a1.455 1.455 0 11-2.058 2.058l-.044-.044a1.2 1.2 0 00-1.324-.24 1.2 1.2 0 00-.727 1.098v.122a1.455 1.455 0 01-2.91 0v-.065a1.2 1.2 0 00-.785-1.097 1.2 1.2 0 00-1.324.24l-.044.043a1.455 1.455 0 11-2.058-2.058l.044-.044a1.2 1.2 0 00.24-1.324 1.2 1.2 0 00-1.098-.727h-.122a1.455 1.455 0 010-2.91h.065a1.2 1.2 0 001.097-.785 1.2 1.2 0 00-.24-1.324l-.043-.044A1.455 1.455 0 114.187 1.84l.044.044a1.2 1.2 0 001.324.24h.058a1.2 1.2 0 00.727-1.098V.904a1.455 1.455 0 012.91 0v.065a1.2 1.2 0 00.727 1.097 1.2 1.2 0 001.324-.24l.044-.043a1.455 1.455 0 112.058 2.058l-.044.044a1.2 1.2 0 00-.24 1.324v.058a1.2 1.2 0 001.098.727h.122a1.455 1.455 0 010 2.91h-.065a1.2 1.2 0 00-1.097.727z" />
              </svg>
            </button>
            <button
              className="ff-shell__quiet-btn"
              onClick={() => setCurrentView('history')}
              type="button"
              aria-label="Open Session History"
              title="Session History"
              style={{ fontSize: 16 }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M8 1.455A6.545 6.545 0 1014.545 8" />
                <path d="M8 4v4l2.5 2.5" />
              </svg>
            </button>
            <button
              className="ff-shell__quiet-btn"
              onClick={() => window.markupr.window.hide()}
              type="button"
            >
              Hide
            </button>
          </div>
        </header>

        <p className="ff-shell__subtitle">{statusCopy.detail}</p>

        <section className="ff-shell__controls">
          <button
            className={`ff-shell__primary-btn ${state === 'recording' ? 'is-live' : ''}`}
            type="button"
            onClick={handlePrimaryAction}
            disabled={primaryActionDisabled}
          >
            {state === 'processing' || state === 'stopping' ? 'Processing\u2026' : primaryActionLabel}
          </button>

          <button
            className="ff-shell__secondary-btn"
            type="button"
            onClick={handlePauseAction}
            disabled={pauseActionDisabled}
          >
            {isPaused ? 'Resume Session' : 'Pause Session'} (<PauseResumeHint inline />)
          </button>

          <button
            className="ff-shell__secondary-btn"
            type="button"
            onClick={handleManualCapture}
            disabled={manualCaptureDisabled}
          >
            Capture Screenshot (<ManualScreenshotHint inline />)
          </button>
        </section>

        <section className="ff-shell__meta">
          <span>{formatDuration(duration)}</span>
          <span>{screenshotCount} screenshots</span>
          <span className={hasTranscriptionCapability ? 'is-ready' : 'is-optional'}>
            {hasTranscriptionCapability ? 'Transcript Ready' : 'Add OpenAI Key'}
          </span>
          {lastCapture && (
            <span title={new Date(lastCapture.timestamp).toLocaleString()}>
              {formatCaptureTrigger(lastCapture.trigger)}
            </span>
          )}
        </section>

        {state === 'idle' && hasRequiredByokKeys === false && (
          <section className="ff-shell__byok-cta">
            <p className="ff-shell__byok-title">BYOK setup required for full reports</p>
            <p className="ff-shell__byok-detail">
              Add your OpenAI and Anthropic API keys in Settings {'>'} Advanced.
            </p>
            <button
              type="button"
              className="ff-shell__byok-btn"
              onClick={() => setCurrentView('settings')}
            >
              Open BYOK Setup
            </button>
          </section>
        )}

        {showRecordingStatus && (
          <section className="ff-shell__transcript">
            <p className="ff-shell__transcript-label">Recording Active</p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(16, 22, 32, 0.72)',
                border: '1px solid rgba(145, 160, 186, 0.26)',
              }}
            >
              <span className="ff-shell__transcript-line">
                {isPaused
                  ? 'Session paused'
                  : isVoiceActive
                    ? 'Mic is active'
                    : 'Listening for narration'}
              </span>
              {settings?.showAudioWaveform !== false && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <CompactAudioIndicator
                    audioLevel={audioLevel}
                    isVoiceActive={isVoiceActive}
                    accentColor="#0a84ff"
                    inactiveColor="#c7c7cc"
                    barCount={7}
                  />
                  <span
                    style={{
                      minWidth: 44,
                      textAlign: 'right',
                      fontSize: 11,
                      color: '#98a7c0',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {Math.round(Math.max(0, Math.min(1, audioLevel)) * 100)}%
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <span className="ff-shell__meta-pill">
                Screenshot: <ManualScreenshotHint inline />
              </span>
              <span className="ff-shell__meta-pill">
                Stop: <ToggleRecordingHint inline />
              </span>
              <span className="ff-shell__meta-pill">
                Pause: <PauseResumeHint inline />
              </span>
            </div>
            <p className="ff-shell__transcript-placeholder" style={{ marginTop: 8 }}>
              Transcript will be generated after you stop recording.
            </p>
          </section>
        )}

        {showProcessingProgress && (
          <section className="ff-shell__processing">
            <p className="ff-shell__processing-label">
              Processing your recording
              <span className="ff-shell__processing-dots" aria-hidden="true">
                {PROCESSING_DOT_FRAMES[processingDotFrame] || PROCESSING_DOT_FRAMES[0]}
              </span>
            </p>
            <div className="ff-shell__processing-bar-track">
              <div
                className="ff-shell__processing-bar-fill"
                style={{ width: `${processingProgress?.percent ?? 0}%` }}
              />
            </div>
            <div className="ff-shell__processing-info">
              <span className="ff-shell__processing-percent">
                {processingProgress?.percent ?? 0}%
              </span>
              <span className="ff-shell__processing-step">
                {processingProgress?.step || 'Preparing...'}
              </span>
            </div>
          </section>
        )}

        {state === 'complete' && reviewSession && showReviewEditor && (
          <SessionReview
            session={reviewSession}
            onSave={handleReviewSave}
            onCopy={handleCopyReportPath}
            onOpenFolder={handleOpenReportFolder}
            onClose={handleReviewClose}
          />
        )}

        {reportPath && (!reviewSession || !showReviewEditor) && (
          <section className="ff-shell__report">
            <p className="ff-shell__report-label">Latest Report Path</p>
            <code className="ff-shell__path">{reportPath}</code>
            <div className="ff-shell__report-actions">
              <button type="button" onClick={handleCopyReportPath}>
                Copy Path
              </button>
              <button type="button" onClick={handleOpenReportFolder}>
                Open Folder
              </button>
              {reviewSession && (
                <button type="button" onClick={() => setShowReviewEditor(true)}>
                  Open Review Editor
                </button>
              )}
            </div>
            {recordingPath && (
              <>
                <p className="ff-shell__report-label">Session Recording</p>
                <code className="ff-shell__path">{recordingPath}</code>
                <div className="ff-shell__report-actions">
                  <button type="button" onClick={handleCopyRecordingPath}>
                    Copy Recording Path
                  </button>
                  <button type="button" onClick={handleOpenReportFolder}>
                    Open Folder
                  </button>
                </div>
              </>
            )}
            {audioPath && (
              <>
                <p className="ff-shell__report-label">Narration Audio</p>
                <code className="ff-shell__path">{audioPath}</code>
                <div className="ff-shell__report-actions">
                  <button type="button" onClick={handleCopyAudioPath}>
                    Copy Audio Path
                  </button>
                  <button type="button" onClick={handleOpenReportFolder}>
                    Open Folder
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {errorMessage && state === 'error' && (
          <section className="ff-shell__error">
            <p>{errorMessage}</p>
          </section>
        )}

        <section className="ff-shell__recent">
          <div className="ff-shell__recent-header">
            <h2>Recent Captures</h2>
            <button type="button" onClick={loadRecentSessions}>
              Refresh
            </button>
          </div>

          {recentSessions.length === 0 ? (
            <p className="ff-shell__empty">No captures yet. Run a session and it will appear here.</p>
          ) : (
            <ul className="ff-shell__recent-list">
              {recentSessions.map((session) => (
                <li key={session.id} className="ff-shell__recent-item">
                  <button
                    className="ff-shell__recent-open"
                    type="button"
                    onClick={() => handleOpenRecent(session)}
                  >
                    <span>{session.sourceName || 'Feedback Session'}</span>
                    <span>{formatRelativeTime(session.startTime)}</span>
                  </button>
                  <div className="ff-shell__recent-meta">
                    <span>{session.itemCount} items</span>
                    <span>{session.screenshotCount} shots</span>
                    <button type="button" onClick={() => handleCopyRecentPath(session)}>
                      Copy File Path
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="ff-shell__footer">
          <p>
            Mic activity is monitored live; narration is transcribed after recording completes.
          </p>
          <p>
            Global hotkey: <ToggleRecordingHint inline /> starts or stops the loop.
          </p>
          <DonateButton className="ff-shell__donate" />
        </footer>
          </>
        )}
      </main>
    </div>
  );
};

export default App;
