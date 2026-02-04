/**
 * FeedbackFlow - Main App Component
 *
 * A minimal, floating UI that shows:
 * - Current recording status
 * - Live transcription preview
 * - Screenshot count
 * - Quick actions
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { SessionStatus, SessionState } from '../shared/types';
import { CrashRecoveryDialog, useCrashRecovery } from './components/CrashRecoveryDialog';

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [transcription, setTranscription] = useState<string>('');
  const [screenshotCount, setScreenshotCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Crash recovery hook - checks for incomplete sessions on startup
  const {
    incompleteSession,
    isCheckingRecovery,
    recoverSession,
    discardSession,
  } = useCrashRecovery();

  // Map SessionState to SessionStatus
  const mapStateToStatus = (state: SessionState): SessionStatus => {
    // SessionState and SessionStatus share the same values
    return state as SessionStatus;
  };

  // Handle session toggle from global hotkey (legacy API)
  useEffect(() => {
    const unsubscribe = window.feedbackflow.onSessionStatus((data) => {
      if (data.action === 'toggle') {
        handleToggle();
      } else if (data.status) {
        // Legacy: status comes as SessionStatusPayload, extract state
        setStatus(mapStateToStatus(data.status.state));
      }
    });
    return unsubscribe;
  }, [status]);

  // Listen to modern session state changes
  useEffect(() => {
    const unsubscribe = window.feedbackflow.session.onStateChange(({ state }) => {
      setStatus(mapStateToStatus(state));
    });
    return unsubscribe;
  }, []);

  // Listen for transcription updates
  useEffect(() => {
    const unsubscribe = window.feedbackflow.onTranscriptionUpdate((data) => {
      setTranscription(data.text);
    });
    return unsubscribe;
  }, []);

  // Listen for screenshots
  useEffect(() => {
    const unsubscribe = window.feedbackflow.onScreenshotCaptured(() => {
      setScreenshotCount((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

  // Listen for output ready
  useEffect(() => {
    const unsubscribe = window.feedbackflow.onOutputReady((data) => {
      setStatus('complete');
      // Auto-copy to clipboard
      window.feedbackflow.copyToClipboard(data.markdown);
    });
    return unsubscribe;
  }, []);

  // Listen for errors
  useEffect(() => {
    const unsubscribe = window.feedbackflow.onOutputError((err) => {
      setStatus('error');
      setError(err.message);
    });
    return unsubscribe;
  }, []);

  const handleToggle = useCallback(async () => {
    if (status === 'idle' || status === 'complete' || status === 'error') {
      // Start new session
      setStatus('recording');
      setTranscription('');
      setScreenshotCount(0);
      setError(null);
      await window.feedbackflow.startSession();
    } else if (status === 'recording') {
      // Stop session
      setStatus('processing');
      await window.feedbackflow.stopSession();
    }
  }, [status]);

  const getStatusColor = (): string => {
    switch (status) {
      case 'recording':
        return '#ef4444'; // red
      case 'processing':
        return '#f59e0b'; // amber
      case 'complete':
        return '#10b981'; // green
      case 'error':
        return '#ef4444'; // red
      default:
        return '#6b7280'; // gray
    }
  };

  const getStatusText = (): string => {
    switch (status) {
      case 'recording':
        return 'Recording...';
      case 'processing':
        return 'Processing...';
      case 'complete':
        return 'Copied to clipboard!';
      case 'error':
        return error || 'Error occurred';
      default:
        return 'Press Cmd+Shift+F to start';
    }
  };

  // Get status-specific animation class
  const getStatusAnimationClass = (): string => {
    switch (status) {
      case 'recording':
        return 'ff-recording-pulse';
      case 'processing':
        return 'ff-processing-pulse';
      case 'complete':
        return 'ff-success-pulse';
      case 'error':
        return 'ff-error-pulse';
      default:
        return '';
    }
  };

  const handleMinimize = () => {
    window.feedbackflow.window.minimize();
  };

  const handleHide = () => {
    window.feedbackflow.window.hide();
  };

  // Handle crash recovery actions
  const handleRecoverSession = useCallback((session: typeof incompleteSession) => {
    if (session) {
      recoverSession();
      // After recovery, show the recovered session items in review mode
      // The recovered data will be available in the session controller
      setStatus('complete');
    }
  }, [recoverSession]);

  const handleDiscardSession = useCallback(() => {
    discardSession();
  }, [discardSession]);

  return (
    <div style={styles.container} className="ff-page-fade">
      {/* Crash Recovery Dialog - shown when incomplete session detected */}
      {incompleteSession && !isCheckingRecovery && (
        <CrashRecoveryDialog
          session={incompleteSession}
          onRecover={handleRecoverSession}
          onDiscard={handleDiscardSession}
        />
      )}

      <div style={styles.card} className="ff-dialog-enter ff-card-hover">
        {/* Window controls */}
        <div style={styles.windowControls}>
          <button
            style={styles.windowButton}
            onClick={handleMinimize}
            title="Minimize (Cmd+M)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="5" width="8" height="2" rx="1" />
            </svg>
          </button>
          <button
            style={styles.windowButton}
            onClick={handleHide}
            title="Hide to tray"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Status indicator */}
        <div style={styles.statusRow}>
          <div
            style={{
              ...styles.statusDot,
              backgroundColor: getStatusColor(),
            }}
            className={status === 'recording' ? 'ff-recording-dot' : ''}
          >
            {/* Ping ring for recording state */}
            {status === 'recording' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: getStatusColor(),
                  borderRadius: '50%',
                }}
                className="ff-recording-ring"
              />
            )}
          </div>
          <span style={styles.statusText} className="ff-transition-colors">
            {getStatusText()}
          </span>
        </div>

        {/* Transcription preview with fade animation */}
        {status === 'recording' && transcription && (
          <div style={styles.transcriptionPreview} className="ff-list-item-enter">
            {transcription.slice(-100)}
            {transcription.length > 100 && '...'}
          </div>
        )}

        {/* Stats with counter animation */}
        {(status === 'recording' || status === 'processing') && (
          <div style={styles.stats} className="ff-fade-in">
            <span className={screenshotCount > 0 ? 'ff-counter-increment' : ''}>
              {screenshotCount} screenshots
            </span>
          </div>
        )}

        {/* Action button with press effect */}
        <button
          style={{
            ...styles.button,
            backgroundColor: status === 'recording' ? '#ef4444' : '#3b82f6',
          }}
          className={`ff-btn-press ${getStatusAnimationClass()}`}
          onClick={handleToggle}
          disabled={status === 'processing'}
        >
          {status === 'processing' ? (
            <span className="ff-processing-rotate" style={{ display: 'inline-block' }}>
              Processing...
            </span>
          ) : status === 'recording' ? (
            'Stop'
          ) : (
            'Start'
          )}
        </button>
      </div>
    </div>
  );
};

// Extended CSS properties to support Electron-specific properties
type ExtendedCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const styles: Record<string, ExtendedCSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    WebkitAppRegion: 'drag',
  },
  card: {
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    WebkitAppRegion: 'no-drag',
    position: 'relative',
  },
  windowControls: {
    position: 'absolute',
    top: 8,
    right: 8,
    display: 'flex',
    gap: 4,
  },
  windowButton: {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#9ca3af',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  statusDot: {
    position: 'relative',
    width: 12,
    height: 12,
    borderRadius: '50%',
    transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  statusText: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: 500,
  },
  transcriptionPreview: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 80,
    overflow: 'hidden',
  },
  stats: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 8,
    border: 'none',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};

export default App;
