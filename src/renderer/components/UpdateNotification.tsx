/**
 * markupR - Update Notification Component
 *
 * Shows update status notifications to the user with:
 * - Update available banner with release notes
 * - Download progress indicator
 * - Ready to install prompt
 *
 * User controls when to download and when to restart.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { UpdateStatusPayload, UpdateStatusType } from '../../shared/types';

// =============================================================================
// Types
// =============================================================================

interface UpdateState {
  status: UpdateStatusType;
  version?: string;
  releaseNotes?: string | null;
  percent?: number;
  message?: string;
}

// =============================================================================
// Component
// =============================================================================

export function UpdateNotification(): React.ReactElement | null {
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Subscribe to update status events
  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    const init = async (): Promise<void> => {
      try {
        const checkForUpdates = await window.markupr.settings.get('checkForUpdates');
        if (!checkForUpdates || !isMounted) {
          setIsDismissed(true);
          return;
        }
      } catch {
        // If settings can't be read, keep default behavior.
      }

      unsubscribe = window.markupr.updates.onStatus((status: UpdateStatusPayload) => {
        // Local/manual builds may not ship updater metadata; suppress that noisy non-actionable state.
        if (
          status.status === 'error' &&
          typeof status.message === 'string' &&
          /(app-update\.yml|latest\.yml|enoent)/i.test(status.message)
        ) {
          setUpdate({ status: 'not-available' });
          setIsDismissed(true);
          return;
        }

        setUpdate({
          status: status.status,
          version: status.version,
          releaseNotes: status.releaseNotes,
          percent: status.percent,
          message: status.message,
        });

        // Auto-expand for important states
        if (status.status === 'available' || status.status === 'ready') {
          setIsExpanded(true);
          setIsDismissed(false);
        }
      });

      window.markupr.updates.check();
    };

    void init();

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  // Handle download button click
  const handleDownload = useCallback(() => {
    window.markupr.updates.download();
  }, []);

  // Handle install/restart button click
  const handleInstall = useCallback(() => {
    window.markupr.updates.install();
  }, []);

  // Handle dismiss (Later button)
  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
  }, []);

  // Handle toggle expand/collapse
  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Don't render if idle, checking, not-available, or dismissed
  if (
    update.status === 'idle' ||
    update.status === 'checking' ||
    update.status === 'not-available' ||
    (update.status === 'error' && !update.message) ||
    isDismissed
  ) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 max-w-sm z-50 animate-slide-up">
      {/* Update Available State */}
      {update.status === 'available' && (
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white p-4 rounded-xl shadow-2xl border border-blue-500/30">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-sm">Update Available</h4>
                <p className="text-xs text-white/80">Version {update.version}</p>
              </div>
            </div>
            <button
              onClick={handleToggleExpand}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <svg
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>

          {/* Release Notes (Expandable) */}
          {isExpanded && update.releaseNotes && (
            <div className="mt-3 p-3 bg-black/20 rounded-lg text-sm max-h-32 overflow-y-auto">
              <h5 className="font-medium text-xs text-white/70 uppercase tracking-wide mb-2">
                {"What's New"}
              </h5>
              <ReleaseNotes notes={update.releaseNotes} />
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleDownload}
              className="flex-1 bg-white text-blue-600 px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-50 transition-colors"
            >
              Download Now
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 text-white/70 hover:text-white text-sm transition-colors"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {/* Downloading State */}
      {update.status === 'downloading' && (
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white p-4 rounded-xl shadow-2xl border border-slate-700/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5 text-blue-400 animate-pulse"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-sm">Downloading Update...</h4>
              <p className="text-xs text-slate-400">Please wait</p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300 ease-out"
              style={{ width: `${update.percent || 0}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2 text-right">
            {Math.round(update.percent || 0)}% complete
          </p>
        </div>
      )}

      {/* Ready to Install State */}
      {update.status === 'ready' && (
        <div className="bg-gradient-to-br from-green-600 to-emerald-700 text-white p-4 rounded-xl shadow-2xl border border-green-500/30">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-sm">Update Ready!</h4>
              <p className="text-xs text-white/80">Version {update.version} is ready to install</p>
            </div>
          </div>

          <p className="text-sm text-white/90 mb-4">
            Restart markupR to apply the update. Your work will be saved.
          </p>

          <button
            onClick={handleInstall}
            className="w-full bg-white text-green-600 px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-green-50 transition-colors flex items-center justify-center gap-2"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Restart Now
          </button>
        </div>
      )}

      {/* Error State */}
      {update.status === 'error' && update.message && (
        <div className="bg-gradient-to-br from-red-600 to-red-700 text-white p-4 rounded-xl shadow-2xl border border-red-500/30">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-sm">Update Failed</h4>
              <p className="text-xs text-white/80">{update.message}</p>
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => window.markupr.updates.check()}
              className="flex-1 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 text-white/70 hover:text-white text-sm transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Safe release notes renderer using React elements instead of dangerouslySetInnerHTML.
 * Prevents XSS from compromised update feeds.
 */
function ReleaseNotes({ notes }: { notes: string }): React.ReactElement {
  const lines = notes.split('\n');
  return (
    <div className="prose prose-sm prose-invert max-w-none text-white/90">
      {lines.map((line, i) => {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith('### ')) return <h3 key={i} className="font-semibold mt-2">{trimmed.slice(4)}</h3>;
        if (trimmed.startsWith('## ')) return <h2 key={i} className="font-semibold mt-2 text-base">{trimmed.slice(3)}</h2>;
        if (trimmed.startsWith('# ')) return <h1 key={i} className="font-bold mt-2 text-lg">{trimmed.slice(2)}</h1>;
        if (/^[-*] /.test(trimmed)) return <li key={i} className="ml-4">{formatInlineText(trimmed.slice(2))}</li>;
        if (trimmed.length === 0) return <br key={i} />;
        return <p key={i}>{formatInlineText(trimmed)}</p>;
      })}
    </div>
  );
}

function formatInlineText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/\*(.+?)\*/);

    const match = boldMatch && italicMatch
      ? (boldMatch.index! <= italicMatch.index! ? boldMatch : italicMatch)
      : (boldMatch || italicMatch);

    if (!match || match.index === undefined) {
      parts.push(remaining);
      break;
    }

    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }

    const isBold = match[0].startsWith('**');
    if (isBold) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
    } else {
      parts.push(<em key={key++}>{match[1]}</em>);
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return parts.length === 1 ? parts[0] : parts;
}

// =============================================================================
// CSS Animation (add to your global styles or Tailwind config)
// =============================================================================

// Add this to your CSS or tailwind.config.js:
// .animate-slide-up {
//   animation: slideUp 0.3s ease-out;
// }
// @keyframes slideUp {
//   from { opacity: 0; transform: translateY(20px); }
//   to { opacity: 1; transform: translateY(0); }
// }

export default UpdateNotification;
