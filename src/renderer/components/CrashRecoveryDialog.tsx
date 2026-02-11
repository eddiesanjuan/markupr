/**
 * CrashRecoveryDialog - Recovery UI for incomplete sessions
 *
 * Shows when markupr detects an incomplete session from a previous
 * crash or abnormal exit. Offers the user the choice to recover or discard.
 */

import React, { useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface RecoverableSession {
  id: string;
  startTime: number;
  lastSaveTime: number;
  feedbackItems: RecoverableFeedbackItem[];
  transcriptionBuffer: string;
  sourceId: string;
  sourceName: string;
  screenshotCount: number;
  metadata?: {
    appVersion: string;
    platform: string;
    sessionDurationMs: number;
  };
}

export interface RecoverableFeedbackItem {
  id: string;
  timestamp: number;
  text: string;
  confidence: number;
  hasScreenshot: boolean;
  screenshotId?: string;
}

export interface CrashRecoveryDialogProps {
  session: RecoverableSession;
  onRecover: (session: RecoverableSession) => void;
  onDiscard: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimeSince(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  return 'just now';
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ============================================================================
// Component
// ============================================================================

export function CrashRecoveryDialog({
  session,
  onRecover,
  onDiscard,
}: CrashRecoveryDialogProps): React.ReactElement {
  const [isRecovering, setIsRecovering] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const timeSince = Date.now() - session.lastSaveTime;
  const formattedTime = formatTimeSince(timeSince);
  const sessionDuration = session.metadata?.sessionDurationMs ||
    (session.lastSaveTime - session.startTime);

  const handleRecover = useCallback(async () => {
    setIsRecovering(true);
    try {
      onRecover(session);
    } catch (error) {
      console.error('Recovery failed:', error);
      setIsRecovering(false);
    }
  }, [onRecover, session]);

  const handleDiscard = useCallback(async () => {
    setIsDiscarding(true);
    try {
      onDiscard();
    } catch (error) {
      console.error('Discard failed:', error);
      setIsDiscarding(false);
    }
  }, [onDiscard]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRecovering || isDiscarding) return;

      if (e.key === 'Enter' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRecover();
      } else if (e.key === 'Escape' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleDiscard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecovering, isDiscarding, handleRecover, handleDiscard]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 overflow-y-auto">
      {/* Dialog Container */}
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full max-h-[calc(100vh-24px)] overflow-y-auto shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-labelledby="recovery-title"
        aria-describedby="recovery-description"
      >
        {/* Icon */}
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* Title */}
        <h2
          id="recovery-title"
          className="text-xl font-semibold text-white text-center mb-2"
        >
          Recover Previous Session?
        </h2>

        {/* Description */}
        <p
          id="recovery-description"
          className="text-gray-400 text-center mb-4"
        >
          markupr found an incomplete session from{' '}
          <span className="text-white font-medium">{formattedTime} ago</span>.
        </p>

        {/* Session Info Card */}
        <div className="bg-gray-800 rounded-lg p-4 mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Source:</span>
            <span className="text-white font-medium truncate ml-2 max-w-[200px]">
              {session.sourceName || 'Unknown'}
            </span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Feedback items:</span>
            <span className="text-white font-medium">
              {session.feedbackItems.length}
            </span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Screenshots:</span>
            <span className="text-white font-medium">
              {session.screenshotCount}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Duration:</span>
            <span className="text-white font-medium">
              {formatDuration(sessionDuration)}
            </span>
          </div>
        </div>

        {/* Expandable Details */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full text-sm text-gray-400 hover:text-gray-300 flex items-center justify-center gap-1 mb-4 transition-colors"
        >
          <svg
            className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
          {showDetails ? 'Hide details' : 'Show details'}
        </button>

        {/* Expandable Content */}
        {showDetails && (
          <div className="bg-gray-800/50 rounded-lg p-3 mb-4 text-xs space-y-2 animate-in slide-in-from-top-2 duration-200 max-h-48 overflow-y-auto">
            <div className="flex justify-between">
              <span className="text-gray-500">Session ID:</span>
              <span className="text-gray-400 font-mono">{session.id.slice(0, 8)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Started:</span>
              <span className="text-gray-400">{formatDate(session.startTime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Last saved:</span>
              <span className="text-gray-400">{formatDate(session.lastSaveTime)}</span>
            </div>
            {session.metadata && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">App version:</span>
                  <span className="text-gray-400">{session.metadata.appVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Platform:</span>
                  <span className="text-gray-400">{session.metadata.platform}</span>
                </div>
              </>
            )}

            {/* Preview first few feedback items */}
            {session.feedbackItems.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <p className="text-gray-500 mb-2">Recent feedback:</p>
                <ul className="space-y-1">
                  {session.feedbackItems.slice(0, 3).map((item, index) => (
                    <li key={item.id || index} className="text-gray-400 truncate">
                      {item.hasScreenshot && (
                        <span className="text-blue-400 mr-1" title="Has screenshot">
                          [img]
                        </span>
                      )}
                      {item.text || '[No text]'}
                    </li>
                  ))}
                  {session.feedbackItems.length > 3 && (
                    <li className="text-gray-500 italic">
                      ...and {session.feedbackItems.length - 3} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Warning about data loss */}
        <div className="flex items-start gap-2 text-xs text-amber-500/80 mb-6 bg-amber-500/10 rounded-lg p-3">
          <svg
            className="w-4 h-4 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            Discarding will permanently delete this session data.
            Recovery will restore your feedback items for review.
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleDiscard}
            disabled={isRecovering || isDiscarding}
            className={`
              flex-1 px-4 py-2.5 rounded-lg font-medium transition-all
              ${isDiscarding
                ? 'bg-gray-700 text-gray-400 cursor-wait'
                : 'text-gray-400 hover:text-white hover:bg-gray-800 active:bg-gray-700'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isDiscarding ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Discarding...
              </span>
            ) : (
              <>
                Discard
                <span className="text-xs text-gray-500 ml-1">(D)</span>
              </>
            )}
          </button>

          <button
            onClick={handleRecover}
            disabled={isRecovering || isDiscarding}
            className={`
              flex-1 px-4 py-2.5 rounded-lg font-medium transition-all
              ${isRecovering
                ? 'bg-blue-700 text-blue-200 cursor-wait'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isRecovering ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Recovering...
              </span>
            ) : (
              <>
                Recover Session
                <span className="text-xs text-blue-300 ml-1">(R)</span>
              </>
            )}
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-center text-xs text-gray-500 mt-4">
          Press <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Enter</kbd> to recover or{' '}
          <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Esc</kbd> to discard
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Hook for managing crash recovery state
// ============================================================================

export interface UseCrashRecoveryReturn {
  incompleteSession: RecoverableSession | null;
  isCheckingRecovery: boolean;
  recoverSession: () => void;
  discardSession: () => void;
  clearRecoveryState: () => void;
}

export function useCrashRecovery(): UseCrashRecoveryReturn {
  const [incompleteSession, setIncompleteSession] =
    useState<RecoverableSession | null>(null);
  const [isCheckingRecovery, setIsCheckingRecovery] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    // Check for incomplete session on mount
    const checkForIncompleteSession = async () => {
      try {
        // Listen for crash recovery notification from main process
        unsubscribe = window.markupr?.crashRecovery.onIncompleteFound(
          (data) => {
            if (data.session) {
              // Map from IPC type to local type
              setIncompleteSession({
                id: data.session.id,
                startTime: data.session.startTime,
                lastSaveTime: data.session.lastSaveTime,
                feedbackItems: data.session.feedbackItems.map((item) => ({
                  id: item.id,
                  timestamp: item.timestamp,
                  text: item.text,
                  confidence: item.confidence,
                  hasScreenshot: item.hasScreenshot,
                })),
                transcriptionBuffer: '',
                sourceId: '',
                sourceName: data.session.sourceName,
                screenshotCount: data.session.screenshotCount,
              });
            }
          }
        );

        // Request check from main process
        const result = await window.markupr?.crashRecovery.check();

        if (result?.session) {
          // Map from IPC type to local type
          setIncompleteSession({
            id: result.session.id,
            startTime: result.session.startTime,
            lastSaveTime: result.session.lastSaveTime,
            feedbackItems: result.session.feedbackItems.map((item) => ({
              id: item.id,
              timestamp: item.timestamp,
              text: item.text,
              confidence: item.confidence,
              hasScreenshot: item.hasScreenshot,
              screenshotId: item.screenshotId,
            })),
            transcriptionBuffer: '',
            sourceId: '',
            sourceName: result.session.sourceName,
            screenshotCount: result.session.screenshotCount,
            metadata: result.session.metadata,
          });
        }
      } catch (error) {
        console.error('Failed to check for incomplete session:', error);
      } finally {
        setIsCheckingRecovery(false);
      }
    };

    checkForIncompleteSession();

    // Cleanup listener on unmount
    return () => {
      unsubscribe?.();
    };
  }, []);

  const recoverSession = async () => {
    if (incompleteSession) {
      await window.markupr?.crashRecovery.recover(incompleteSession.id);
      setIncompleteSession(null);
    }
  };

  const discardSession = async () => {
    await window.markupr?.crashRecovery.discard();
    setIncompleteSession(null);
  };

  const clearRecoveryState = () => {
    setIncompleteSession(null);
  };

  return {
    incompleteSession,
    isCheckingRecovery,
    recoverSession,
    discardSession,
    clearRecoveryState,
  };
}

// Default export for convenience
export default CrashRecoveryDialog;
