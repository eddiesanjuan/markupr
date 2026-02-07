/**
 * AppWrapper.tsx - Handles startup checks before showing the main app
 *
 * Responsibilities:
 * 1. Check if Whisper model is downloaded on first launch
 * 2. Show model download prompt if needed
 * 3. Block recording until transcription capability is available
 */

import React, { useState, useEffect, useCallback } from 'react';
import App from './App';
import { ModelDownloadDialog, useModelCheck } from './components/ModelDownloadDialog';

// ============================================================================
// Loading Spinner Component
// ============================================================================

const LoadingSpinner: React.FC = () => (
  <div style={styles.loadingContainer}>
    <div style={styles.loadingContent}>
      <div style={styles.spinner} />
      <p style={styles.loadingText}>Loading FeedbackFlow...</p>
    </div>
  </div>
);

// ============================================================================
// Main AppWrapper Component
// ============================================================================

export const AppWrapper: React.FC = () => {
  const { isChecking, needsDownload, hasTranscriptionCapability } = useModelCheck();
  const [userSkipped, setUserSkipped] = useState(false);
  const [downloadCompleted, setDownloadCompleted] = useState(false);

  // Derive whether to show dialog directly from state (no useEffect race condition)
  const shouldShowDialog = !isChecking && needsDownload && !hasTranscriptionCapability && !userSkipped && !downloadCompleted;

  // Resize popover when showing download dialog
  useEffect(() => {
    if (shouldShowDialog) {
      // Resize to accommodate the download dialog
      window.feedbackflow?.popover?.resize?.(420, 780).catch(() => {
        // Ignore errors - popover resize is optional
      });
    }
  }, [shouldShowDialog]);

  // Handle download completion - resize back and continue
  const handleDownloadComplete = useCallback(() => {
    setDownloadCompleted(true);
    // Resize back to idle size
    window.feedbackflow?.popover?.resizeToState?.('idle').catch(() => {});
  }, []);

  // Handle skip - resize back and continue (recording will be blocked)
  const handleSkip = useCallback(() => {
    setUserSkipped(true);
    // Resize back to idle size
    window.feedbackflow?.popover?.resizeToState?.('idle').catch(() => {});
  }, []);

  // Show loading while checking
  if (isChecking) {
    return <LoadingSpinner />;
  }

  // Show download dialog if needed
  if (shouldShowDialog) {
    return (
      <ModelDownloadDialog
        onComplete={handleDownloadComplete}
        onSkip={handleSkip}
      />
    );
  }

  // Show main app
  return (
    <AppWithTranscriptionState
      hasTranscriptionCapability={hasTranscriptionCapability || downloadCompleted}
    />
  );
};

// ============================================================================
// App with Transcription State
// ============================================================================

interface AppWithTranscriptionStateProps {
  hasTranscriptionCapability: boolean;
}

const AppWithTranscriptionState: React.FC<AppWithTranscriptionStateProps> = ({
  hasTranscriptionCapability,
}) => {
  // Store the capability state globally for the session start check
  useEffect(() => {
    (window as typeof window & { __hasTranscriptionCapability: boolean }).__hasTranscriptionCapability = hasTranscriptionCapability;
  }, [hasTranscriptionCapability]);

  return <App />;
};

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  loadingContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // Solid background for transparent Electron window
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  },

  loadingContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },

  spinner: {
    width: 32,
    height: 32,
    border: '3px solid rgba(59, 130, 246, 0.2)',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },

  loadingText: {
    color: '#9ca3af',
    fontSize: 14,
  },
};

export default AppWrapper;
