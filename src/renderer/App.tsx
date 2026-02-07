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
  RecordingOverlay,
  ExportDialog,
  SessionReview,
} from './components';
import { SessionHistory } from './components/SessionHistory';
import { ToggleRecordingHint, ManualScreenshotHint } from './components/HotkeyHint';
import StatusIndicator from './components/StatusIndicator';
import './styles/app-shell.css';

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
  const [audioLevel, setAudioLevel] = useState(0);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);

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
    window.feedbackflow.settings.getAll().then(setSettings).catch(() => {
      // Settings load failure is non-fatal
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Recent sessions (existing)
  // ---------------------------------------------------------------------------
  const loadRecentSessions = useCallback(async () => {
    try {
      if (!window.feedbackflow?.output?.listSessions) {
        setRecentSessions([]);
        return;
      }
      const sessions = await window.feedbackflow.output.listSessions();
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
    window.feedbackflow.whisper
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
  const syncScreenRecording = useCallback(async (nextState: SessionState, session: SessionPayload | null) => {
    const recorder = screenRecorderRef.current;

    if (nextState === 'recording') {
      if (recorder.isRecording()) {
        return;
      }

      const activeSession = session || (await window.feedbackflow.session.getCurrent());
      if (!activeSession) {
        return;
      }

      try {
        await recorder.start({
          sessionId: activeSession.id,
          sourceId: activeSession.sourceId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown screen recording error.';
        console.warn('[App] Continuous screen recording failed to start:', message);
        setErrorMessage((prev) => prev || `Screen recording unavailable: ${message}`);
      }
      return;
    }

    if (recorder.isRecording()) {
      await recorder.stop().catch((error) => {
        console.warn('[App] Failed to stop continuous screen recording:', error);
      });
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Session IPC listeners (existing)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    const recorder = screenRecorderRef.current;

    window.feedbackflow.session
      .getStatus()
      .then((status) => {
        if (!mounted) return;
        setState(status.state);
        setDuration(status.duration);
        setScreenshotCount(status.screenshotCount);
      })
      .catch((error) => {
        console.error('[App] Failed to load initial status:', error);
      });

    const unsubState = window.feedbackflow.session.onStateChange(({ state: nextState, session }) => {
      setState(nextState);
      void syncScreenRecording(nextState, session);
      if (nextState === 'recording') {
        setErrorMessage(null);
        setReportPath(null);
        setRecordingPath(null);
        setAudioPath(null);
        setSessionDir(null);
        setReviewSession(null);
        // Dismiss overlays when recording starts
        setCurrentView('main');
        setShowCountdown(false);
      }
      if (nextState === 'idle') {
        setDuration(0);
      }
    });

    const unsubStatus = window.feedbackflow.session.onStatusUpdate((status) => {
      setDuration(status.duration);
      setScreenshotCount(status.screenshotCount);
      setState(status.state);
    });

    const unsubScreenshot = window.feedbackflow.capture.onScreenshot((payload) => {
      setScreenshotCount(payload.count);
      setLastCapture({
        trigger: payload.trigger,
        timestamp: payload.timestamp,
      });
    });

    const unsubReady = window.feedbackflow.output.onReady((payload) => {
      setState('complete');
      setErrorMessage(null);
      setReportPath(payload.path || payload.reportPath || null);
      setRecordingPath(payload.recordingPath || null);
      setAudioPath(payload.audioPath || null);
      setSessionDir(payload.sessionDir || null);
      setReviewSession(payload.reviewSession || null);
      setDuration(0);
      loadRecentSessions();
    });

    const unsubSessionError = window.feedbackflow.session.onError((payload) => {
      setState('error');
      setErrorMessage(payload.message);
    });

    const unsubOutputError = window.feedbackflow.output.onError((payload) => {
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
    const unsubLevel = window.feedbackflow.audio.onLevel((level) => {
      setAudioLevel(level);
    });
    const unsubVoice = window.feedbackflow.audio.onVoiceActivity((active) => {
      setIsVoiceActive(active);
    });
    return () => {
      unsubLevel();
      unsubVoice();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Navigation event listeners (new - from main process menu/tray)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const nav = window.feedbackflow.navigation;
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
      window.feedbackflow.popover.resize(width, height).catch(() => {
        // Popover controls are optional in non-popover mode.
      });
      return;
    }

    window.feedbackflow.popover.resizeToState(mapPopoverState(state)).catch(() => {
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
          detail: 'Speak while testing. Transcript is generated after you stop recording.',
        };
      case 'stopping':
      case 'processing':
        return {
          title: 'Building Report',
          detail: 'Generating markdown and linking screenshots to context.',
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
              ? 'Recording works now. Add Whisper or Deepgram for automatic transcript generation after stop.'
              : 'Press Cmd+Shift+F to start a fresh feedback pass.',
        };
    }
  }, [state, errorMessage, hasTranscriptionCapability]);

  // ---------------------------------------------------------------------------
  // Derived state (existing)
  // ---------------------------------------------------------------------------
  const primaryActionLabel = state === 'recording' ? 'Stop Session' : 'Start Session';
  const primaryActionDisabled = isMutating || state === 'starting' || state === 'stopping' || state === 'processing';
  const manualCaptureDisabled = isMutating || state !== 'recording';

  const countdownDuration = settings?.defaultCountdown ?? 0;
  const showAudioWaveform = settings?.showAudioWaveform ?? true;

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
        const result = await window.feedbackflow.session.stop();
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

      const result = await window.feedbackflow.session.start();
      if (!result.success) {
        setState('error');
        setErrorMessage(result.error || 'Unable to start session.');
        window.feedbackflow.whisper
          .hasTranscriptionCapability()
          .then((ready) => setHasTranscriptionCapability(ready))
          .catch(() => {
            // Keep previous badge state when status refresh fails.
          });
      }
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown session error.');
    } finally {
      setIsMutating(false);
    }
  }, [primaryActionDisabled, state, countdownDuration]);

  const handleCountdownComplete = useCallback(async () => {
    setShowCountdown(false);
    setIsMutating(true);
    try {
      setScreenshotCount(0);
      setLastCapture(null);
      setRecordingPath(null);
      setAudioPath(null);
      setErrorMessage(null);

      const result = await window.feedbackflow.session.start();
      if (!result.success) {
        setState('error');
        setErrorMessage(result.error || 'Unable to start session.');
      }
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown session error.');
    } finally {
      setIsMutating(false);
    }
  }, []);

  const handleCountdownSkip = useCallback(() => {
    setShowCountdown(false);
  }, []);

  const handleManualCapture = useCallback(async () => {
    if (manualCaptureDisabled) return;
    const result = await window.feedbackflow.capture.manualScreenshot();
    if (!result.success) {
      setErrorMessage('Manual capture failed.');
    }
  }, [manualCaptureDisabled]);

  const handleCopyReportPath = useCallback(async () => {
    if (!reportPath) return;
    await window.feedbackflow.copyToClipboard(reportPath);
  }, [reportPath]);

  const handleOpenReportFolder = useCallback(async () => {
    if (sessionDir) {
      await window.feedbackflow.output.openFolder(sessionDir);
      return;
    }
    if (reportPath) {
      await window.feedbackflow.output.openFolder(reportPath);
    }
  }, [sessionDir, reportPath]);

  const handleCopyRecordingPath = useCallback(async () => {
    if (!recordingPath) return;
    await window.feedbackflow.copyToClipboard(recordingPath);
  }, [recordingPath]);

  const handleCopyAudioPath = useCallback(async () => {
    if (!audioPath) return;
    await window.feedbackflow.copyToClipboard(audioPath);
  }, [audioPath]);

  const handleOpenRecent = useCallback(async (session: RecentSession) => {
    await window.feedbackflow.output.openFolder(session.folder);
  }, []);

  const handleCopyRecentPath = useCallback(async (session: RecentSession) => {
    await window.feedbackflow.copyToClipboard(`${session.folder}/feedback-report.md`);
  }, []);

  const handleRecoverSession = useCallback(() => {
    recoverSession();
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
    window.feedbackflow.whisper
      .hasTranscriptionCapability()
      .then((ready) => setHasTranscriptionCapability(ready))
      .catch(() => {});
  }, []);

  const handleOnboardingSkip = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  const handleOpenSession = useCallback(async (session: { folder: string }) => {
    await window.feedbackflow.output.openFolder(session.folder);
  }, []);

  const handleExport = useCallback(async () => {
    // No-op for now; the ExportDialog handles its own export logic.
    setShowExportDialog(false);
  }, []);

  const handleReviewSave = useCallback(async (_session: ReviewSession) => {
    // Save edited session back to main process
    try {
      await window.feedbackflow.output.save();
    } catch {
      // Save failure is non-fatal in review mode
    }
  }, []);

  const handleReviewClose = useCallback(() => {
    setReviewSession(null);
    setState('idle');
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={`ff-shell ff-shell--${state}`}>
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
      <main className="ff-shell__card">
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
              onClick={() => window.feedbackflow.window.hide()}
              type="button"
            >
              Hide
            </button>
          </div>
        </header>

        <p className="ff-shell__subtitle">{statusCopy.detail}</p>

        {/* === Recording Overlay (compact indicator during recording) === */}
        {state === 'recording' && (
          <RecordingOverlay
            duration={Math.floor(duration / 1000)}
            screenshotCount={screenshotCount}
            isDarkMode={false}
            onStop={async () => {
              const result = await window.feedbackflow.session.stop();
              if (!result.success) {
                setState('error');
                setErrorMessage(result.error || 'Unable to stop session.');
              }
            }}
          />
        )}

        {/* === Audio Waveform (during recording, when enabled) === */}
        {state === 'recording' && showAudioWaveform && (
          <div style={{ padding: '0 2px' }}>
            <CompactAudioIndicator
              audioLevel={audioLevel}
              isVoiceActive={isVoiceActive}
              accentColor="#0a84ff"
              inactiveColor="#c7c7cc"
            />
          </div>
        )}

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
            {hasTranscriptionCapability ? 'Transcript Enabled' : 'Transcript Optional'}
          </span>
          {lastCapture && (
            <span title={new Date(lastCapture.timestamp).toLocaleString()}>
              {formatCaptureTrigger(lastCapture.trigger)}
            </span>
          )}
        </section>

        {state === 'recording' && (
          <section className="ff-shell__transcript">
            <p className="ff-shell__transcript-label">Narration Capture</p>
            <p className="ff-shell__transcript-line">
              Audio is recording now. Transcript generation runs automatically when you stop.
            </p>
          </section>
        )}

        {state === 'complete' && reviewSession && (
          <SessionReview
            session={reviewSession}
            onSave={handleReviewSave}
            onCopy={handleCopyReportPath}
            onOpenFolder={handleOpenReportFolder}
            onClose={handleReviewClose}
          />
        )}

        {reportPath && !reviewSession && (
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
      </main>
    </div>
  );
};

export default App;
