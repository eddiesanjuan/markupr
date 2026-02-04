/**
 * Transcription Preview Component
 *
 * A real-time transcription overlay showing live subtitles during recording.
 *
 * Features:
 * - Words appear as they're transcribed with smooth fade-in
 * - Auto-hide after 3 seconds of silence
 * - Position options: bottom-center, bottom-left, bottom-right
 * - Premium typography with backdrop blur
 * - Visual distinction between interim and final transcripts
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { TranscriptChunkPayload } from '../../shared/types';

export interface TranscriptionPreviewProps {
  /** Current transcript data from Deepgram */
  transcript: TranscriptChunkPayload | null;
  /** Position of the overlay on screen */
  position?: 'bottom-center' | 'bottom-left' | 'bottom-right';
  /** Whether the overlay is visible (user preference) */
  isVisible: boolean;
  /** Callback when user toggles visibility */
  onToggle?: () => void;
  /** Whether to use dark mode styling */
  isDarkMode?: boolean;
}

interface AnimatedWord {
  text: string;
  id: string;
  timestamp: number;
}

// Time in ms before the overlay fades out after no new text
const HIDE_DELAY_MS = 3000;
// Maximum characters to display in the overlay
const MAX_DISPLAY_CHARS = 150;
// Animation timings
const FADE_IN_MS = 200;
const FADE_OUT_MS = 500;

export const TranscriptionPreview: React.FC<TranscriptionPreviewProps> = ({
  transcript,
  position = 'bottom-center',
  isVisible,
  onToggle,
  isDarkMode = true,
}) => {
  const [displayText, setDisplayText] = useState('');
  const [isShowing, setIsShowing] = useState(false);
  const [words, setWords] = useState<AnimatedWord[]>([]);
  const hideTimeoutRef = useRef<NodeJS.Timeout>();
  const lastUpdateRef = useRef<number>(0);
  const wordIdCounter = useRef(0);

  // Memoize position styles
  const positionStyles = useMemo(() => {
    const baseStyles: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9998, // Below recording overlay (9999)
    };

    switch (position) {
      case 'bottom-center':
        return {
          ...baseStyles,
          bottom: 32,
          left: '50%',
          transform: 'translateX(-50%)',
        };
      case 'bottom-left':
        return {
          ...baseStyles,
          bottom: 32,
          left: 32,
        };
      case 'bottom-right':
        return {
          ...baseStyles,
          bottom: 32,
          right: 32,
        };
      default:
        return {
          ...baseStyles,
          bottom: 32,
          left: '50%',
          transform: 'translateX(-50%)',
        };
    }
  }, [position]);

  // Process incoming transcript
  useEffect(() => {
    if (!transcript?.text) return;

    const now = Date.now();
    lastUpdateRef.current = now;

    // Update display text (truncate if needed)
    const text = transcript.text;
    const truncatedText =
      text.length > MAX_DISPLAY_CHARS
        ? '...' + text.slice(-MAX_DISPLAY_CHARS)
        : text;
    setDisplayText(truncatedText);

    // Parse words for animation if available
    if (transcript.words && transcript.words.length > 0) {
      const newWords: AnimatedWord[] = transcript.words.map((w) => ({
        text: w.word,
        id: `word-${wordIdCounter.current++}`,
        timestamp: now,
      }));
      setWords(newWords);
    }

    // Show the overlay
    setIsShowing(true);

    // Reset hide timer
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }

    hideTimeoutRef.current = setTimeout(() => {
      setIsShowing(false);
    }, HIDE_DELAY_MS);

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [transcript]);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Don't render if visibility is disabled or no text
  if (!isVisible || !displayText) return null;

  // Theme colors
  const theme = {
    bg: isDarkMode ? 'rgba(0, 0, 0, 0.80)' : 'rgba(255, 255, 255, 0.90)',
    text: isDarkMode ? '#ffffff' : '#1f2937',
    textInterim: isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(31, 41, 55, 0.7)',
    border: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    shadow: isDarkMode
      ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)'
      : '0 8px 32px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
  };

  return (
    <>
      {/* Keyframe animations */}
      <style>
        {`
          @keyframes feedbackflow-subtitle-fade-in {
            0% {
              opacity: 0;
              transform: translateY(8px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes feedbackflow-subtitle-fade-out {
            0% {
              opacity: 1;
              transform: translateY(0);
            }
            100% {
              opacity: 0;
              transform: translateY(8px);
            }
          }

          @keyframes feedbackflow-word-pop {
            0% {
              opacity: 0;
              transform: scale(0.9);
            }
            50% {
              opacity: 1;
              transform: scale(1.02);
            }
            100% {
              opacity: 1;
              transform: scale(1);
            }
          }

          .feedbackflow-subtitle-container {
            animation: feedbackflow-subtitle-fade-in ${FADE_IN_MS}ms ease-out forwards;
          }

          .feedbackflow-subtitle-container.hiding {
            animation: feedbackflow-subtitle-fade-out ${FADE_OUT_MS}ms ease-out forwards;
          }

          .feedbackflow-word {
            display: inline-block;
            animation: feedbackflow-word-pop ${FADE_IN_MS}ms ease-out forwards;
          }
        `}
      </style>

      <div
        className={`feedbackflow-subtitle-container ${!isShowing ? 'hiding' : ''}`}
        style={{
          ...positionStyles,
          maxWidth: 640,
          padding: '14px 24px',
          backgroundColor: theme.bg,
          borderRadius: 16,
          boxShadow: theme.shadow,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: `1px solid ${theme.border}`,
          // Typography - premium subtitle feel
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: 18,
          fontWeight: 500,
          lineHeight: 1.5,
          letterSpacing: '-0.01em',
          textAlign: position === 'bottom-center' ? 'center' : 'left',
          color: transcript?.isFinal ? theme.text : theme.textInterim,
          // Text shadow for readability over any background
          textShadow: isDarkMode
            ? '0 1px 2px rgba(0, 0, 0, 0.3)'
            : '0 1px 2px rgba(255, 255, 255, 0.5)',
          // Prevent window drag on Electron
          WebkitAppRegion: 'no-drag',
          // Smooth transition for color changes
          transition: `color ${FADE_IN_MS}ms ease`,
          // Pointer events
          pointerEvents: 'none',
        } as React.CSSProperties & { WebkitAppRegion?: string }}
        role="status"
        aria-live="polite"
        aria-label="Live transcription"
      >
        {displayText}
      </div>
    </>
  );
};

/**
 * Word-by-word animated variant for premium feel
 * Use this when you want each word to animate in separately
 */
export const TranscriptionPreviewAnimated: React.FC<TranscriptionPreviewProps> = ({
  transcript,
  position = 'bottom-center',
  isVisible,
  isDarkMode = true,
}) => {
  const [words, setWords] = useState<AnimatedWord[]>([]);
  const [isShowing, setIsShowing] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout>();
  const wordIdCounter = useRef(0);
  const previousTextRef = useRef('');

  // Memoize position styles
  const positionStyles = useMemo(() => {
    const baseStyles: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9998,
    };

    switch (position) {
      case 'bottom-center':
        return { ...baseStyles, bottom: 32, left: '50%', transform: 'translateX(-50%)' };
      case 'bottom-left':
        return { ...baseStyles, bottom: 32, left: 32 };
      case 'bottom-right':
        return { ...baseStyles, bottom: 32, right: 32 };
      default:
        return { ...baseStyles, bottom: 32, left: '50%', transform: 'translateX(-50%)' };
    }
  }, [position]);

  // Process incoming transcript with word-by-word animation
  useEffect(() => {
    if (!transcript?.text) return;

    const currentText = transcript.text;
    const previousText = previousTextRef.current;

    // Find new words by comparing with previous text
    if (currentText !== previousText) {
      const currentWords = currentText.split(/\s+/).filter(Boolean);
      const previousWords = previousText.split(/\s+/).filter(Boolean);

      // Keep existing words, add new ones
      const newWords = currentWords.slice(previousWords.length);

      if (newWords.length > 0) {
        const now = Date.now();
        const animatedNewWords: AnimatedWord[] = newWords.map((word, index) => ({
          text: word,
          id: `word-${wordIdCounter.current++}`,
          timestamp: now + index * 50, // Stagger animation
        }));

        setWords((prev) => {
          // Limit total words to prevent overflow
          const maxWords = 30;
          const combined = [...prev, ...animatedNewWords];
          return combined.slice(-maxWords);
        });
      }

      previousTextRef.current = currentText;
    }

    // Show overlay
    setIsShowing(true);

    // Reset hide timer
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }

    hideTimeoutRef.current = setTimeout(() => {
      setIsShowing(false);
      // Clear words after fade out
      setTimeout(() => {
        setWords([]);
        previousTextRef.current = '';
      }, FADE_OUT_MS);
    }, HIDE_DELAY_MS);

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [transcript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  if (!isVisible || words.length === 0) return null;

  const theme = {
    bg: isDarkMode ? 'rgba(0, 0, 0, 0.80)' : 'rgba(255, 255, 255, 0.90)',
    text: isDarkMode ? '#ffffff' : '#1f2937',
    textInterim: isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(31, 41, 55, 0.7)',
    border: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    shadow: isDarkMode
      ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)'
      : '0 8px 32px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
  };

  return (
    <>
      <style>
        {`
          @keyframes feedbackflow-subtitle-fade-in {
            0% { opacity: 0; transform: translateY(8px); }
            100% { opacity: 1; transform: translateY(0); }
          }

          @keyframes feedbackflow-subtitle-fade-out {
            0% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(8px); }
          }

          @keyframes feedbackflow-word-pop {
            0% { opacity: 0; transform: translateY(4px) scale(0.95); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
          }

          .feedbackflow-subtitle-animated {
            animation: feedbackflow-subtitle-fade-in ${FADE_IN_MS}ms ease-out forwards;
          }

          .feedbackflow-subtitle-animated.hiding {
            animation: feedbackflow-subtitle-fade-out ${FADE_OUT_MS}ms ease-out forwards;
          }

          .feedbackflow-animated-word {
            display: inline-block;
            animation: feedbackflow-word-pop ${FADE_IN_MS}ms ease-out forwards;
            animation-fill-mode: both;
          }
        `}
      </style>

      <div
        className={`feedbackflow-subtitle-animated ${!isShowing ? 'hiding' : ''}`}
        style={{
          ...positionStyles,
          maxWidth: 640,
          padding: '14px 24px',
          backgroundColor: theme.bg,
          borderRadius: 16,
          boxShadow: theme.shadow,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: `1px solid ${theme.border}`,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: 18,
          fontWeight: 500,
          lineHeight: 1.5,
          letterSpacing: '-0.01em',
          textAlign: position === 'bottom-center' ? 'center' : 'left',
          color: transcript?.isFinal ? theme.text : theme.textInterim,
          textShadow: isDarkMode
            ? '0 1px 2px rgba(0, 0, 0, 0.3)'
            : '0 1px 2px rgba(255, 255, 255, 0.5)',
          WebkitAppRegion: 'no-drag',
          pointerEvents: 'none',
        } as React.CSSProperties & { WebkitAppRegion?: string }}
        role="status"
        aria-live="polite"
        aria-label="Live transcription"
      >
        {words.map((word, index) => (
          <span
            key={word.id}
            className="feedbackflow-animated-word"
            style={{
              animationDelay: `${index * 30}ms`,
              marginRight: '0.25em',
            }}
          >
            {word.text}
          </span>
        ))}
      </div>
    </>
  );
};

export default TranscriptionPreview;
