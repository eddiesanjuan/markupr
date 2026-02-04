/**
 * Recording Overlay Component
 *
 * A compact, draggable floating indicator showing:
 * - Recording duration (MM:SS)
 * - Pulsing red recording dot
 * - Stop button
 * - +1 badge animation on screenshot capture
 *
 * Design: Premium, minimal, non-intrusive (120x32px approx)
 * Position persists across sessions via localStorage
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface RecordingOverlayProps {
  duration: number; // seconds
  screenshotCount: number;
  onStop: () => void;
  isDarkMode?: boolean;
}

interface Position {
  x: number;
  y: number;
}

const STORAGE_KEY = 'feedbackflow-overlay-position';
const DEFAULT_POSITION: Position = { x: 20, y: 20 };

export const RecordingOverlay: React.FC<RecordingOverlayProps> = ({
  duration,
  screenshotCount,
  onStop,
  isDarkMode = true,
}) => {
  const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
  const [isDragging, setIsDragging] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [badgeKey, setBadgeKey] = useState(0);

  const prevCountRef = useRef(screenshotCount);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Format duration as MM:SS
  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Load persisted position on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Position;
        // Validate position is within viewport
        const maxX = window.innerWidth - 140;
        const maxY = window.innerHeight - 40;
        setPosition({
          x: Math.min(Math.max(0, parsed.x), maxX),
          y: Math.min(Math.max(0, parsed.y), maxY),
        });
      }
    } catch {
      // Use default position on error
    }
  }, []);

  // Save position when it changes (debounced)
  useEffect(() => {
    if (!isDragging) {
      const timeout = setTimeout(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
        } catch {
          // Ignore storage errors
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [position, isDragging]);

  // Show +1 badge animation when screenshot count increases
  useEffect(() => {
    if (screenshotCount > prevCountRef.current) {
      setShowBadge(true);
      setBadgeKey((prev) => prev + 1); // Force re-render for animation
      const timer = setTimeout(() => setShowBadge(false), 1200);
      prevCountRef.current = screenshotCount;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = screenshotCount;
  }, [screenshotCount]);

  // Handle mouse down for drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking the stop button
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  // Handle mouse move for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;

      // Calculate new position with bounds checking
      const overlayWidth = overlayRef.current?.offsetWidth || 140;
      const overlayHeight = overlayRef.current?.offsetHeight || 36;
      const maxX = window.innerWidth - overlayWidth;
      const maxY = window.innerHeight - overlayHeight;

      setPosition({
        x: Math.min(Math.max(0, dragStartRef.current.posX + deltaX), maxX),
        y: Math.min(Math.max(0, dragStartRef.current.posY + deltaY), maxY),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Dynamic styles based on theme
  const theme = {
    bg: isDarkMode ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
    border: isDarkMode ? 'rgba(75, 85, 99, 0.5)' : 'rgba(209, 213, 219, 0.8)',
    text: isDarkMode ? '#f3f4f6' : '#1f2937',
    textMuted: isDarkMode ? '#9ca3af' : '#6b7280',
    stopBg: '#dc2626',
    stopHover: '#b91c1c',
    badgeBg: '#10b981',
    recordingDot: '#ef4444',
  };

  return (
    <>
      {/* Keyframe animations */}
      <style>
        {`
          @keyframes feedbackflow-pulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.6;
              transform: scale(0.95);
            }
          }

          @keyframes feedbackflow-ping {
            0% {
              transform: scale(1);
              opacity: 0.75;
            }
            75%, 100% {
              transform: scale(2);
              opacity: 0;
            }
          }

          @keyframes feedbackflow-badge-pop {
            0% {
              transform: scale(0) translateY(0);
              opacity: 0;
            }
            20% {
              transform: scale(1.2) translateY(-2px);
              opacity: 1;
            }
            40% {
              transform: scale(1) translateY(-4px);
            }
            100% {
              transform: scale(0.8) translateY(-16px);
              opacity: 0;
            }
          }

          @keyframes feedbackflow-glow {
            0%, 100% {
              box-shadow: 0 0 4px rgba(239, 68, 68, 0.4),
                          0 0 8px rgba(239, 68, 68, 0.2);
            }
            50% {
              box-shadow: 0 0 8px rgba(239, 68, 68, 0.6),
                          0 0 16px rgba(239, 68, 68, 0.3);
            }
          }
        `}
      </style>

      <div
        ref={overlayRef}
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          backgroundColor: theme.bg,
          borderRadius: 20,
          boxShadow: `
            0 4px 6px -1px rgba(0, 0, 0, 0.1),
            0 2px 4px -1px rgba(0, 0, 0, 0.06),
            0 0 0 1px ${theme.border}
          `,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          transition: isDragging ? 'none' : 'box-shadow 0.2s ease',
          animation: 'feedbackflow-glow 2s ease-in-out infinite',
          // Electron-specific: prevent window drag
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties & { WebkitAppRegion?: string }}
        onMouseDown={handleMouseDown}
      >
        {/* Pulsing red recording dot */}
        <div style={{ position: 'relative', width: 10, height: 10 }}>
          {/* Ping animation (outer ring) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: theme.recordingDot,
              borderRadius: '50%',
              animation: 'feedbackflow-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
            }}
          />
          {/* Solid dot with pulse */}
          <div
            style={{
              position: 'relative',
              width: 10,
              height: 10,
              backgroundColor: theme.recordingDot,
              borderRadius: '50%',
              animation: 'feedbackflow-pulse 1.5s ease-in-out infinite',
            }}
          />
        </div>

        {/* Duration display */}
        <span
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: 13,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: theme.text,
            minWidth: 42,
            textAlign: 'center',
            letterSpacing: '0.02em',
          }}
        >
          {formatDuration(duration)}
        </span>

        {/* Screenshot count (subtle) */}
        {screenshotCount > 0 && (
          <span
            style={{
              fontSize: 11,
              color: theme.textMuted,
              paddingRight: 4,
            }}
          >
            {screenshotCount}
          </span>
        )}

        {/* +1 Badge (animated, appears on screenshot) */}
        {showBadge && (
          <span
            key={badgeKey}
            style={{
              position: 'absolute',
              top: -8,
              right: 50,
              padding: '2px 6px',
              backgroundColor: theme.badgeBg,
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 10,
              animation: 'feedbackflow-badge-pop 1.2s ease-out forwards',
              pointerEvents: 'none',
            }}
          >
            +1
          </span>
        )}

        {/* Stop button */}
        <button
          onClick={onStop}
          style={{
            padding: '4px 10px',
            backgroundColor: theme.stopBg,
            border: 'none',
            borderRadius: 12,
            color: '#ffffff',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            outline: 'none',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.stopHover;
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = theme.stopBg;
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
        >
          Stop
        </button>
      </div>
    </>
  );
};

export default RecordingOverlay;
