/**
 * Recording Overlay Component
 *
 * A compact floating indicator showing:
 * - Recording duration (MM:SS)
 * - Pulsing red recording dot
 * - Stop button
 * - +1 badge animation on screenshot capture
 *
 * Design: Premium, subtle glass HUD that stays readable without feeling heavy
 * Position persists across sessions via localStorage
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CompactAudioIndicator } from './AudioWaveform';

interface RecordingOverlayProps {
  duration: number; // seconds
  screenshotCount: number;
  onStop: () => void;
  isDarkMode?: boolean;
  audioLevel?: number;
  isVoiceActive?: boolean;
  manualShortcut?: string;
  toggleShortcut?: string;
  pauseShortcut?: string;
}

const DEFAULT_WIDTH = 300;

function formatCompactShortcut(accelerator: string, isMac: boolean): string {
  if (!accelerator || accelerator.trim().length === 0) {
    return isMac ? '⌘⇧?' : 'Ctrl+Shift+?';
  }

  const normalized = accelerator
    .replace(/CommandOrControl/gi, isMac ? 'Command' : 'Control')
    .replace(/CmdOrCtrl/gi, isMac ? 'Command' : 'Control');
  const keys = normalized.split('+').map((part) => part.trim()).filter(Boolean);

  if (!isMac) {
    return keys
      .map((key) => {
        const lower = key.toLowerCase();
        if (lower === 'control' || lower === 'ctrl') return 'Ctrl';
        if (lower === 'alt' || lower === 'option') return 'Alt';
        if (lower === 'shift') return 'Shift';
        if (lower === 'command' || lower === 'cmd') return 'Ctrl';
        return key.length === 1 ? key.toUpperCase() : key;
      })
      .join('+');
  }

  const symbolMap: Record<string, string> = {
    command: '⌘',
    cmd: '⌘',
    control: '⌃',
    ctrl: '⌃',
    alt: '⌥',
    option: '⌥',
    shift: '⇧',
    enter: '↩',
    return: '↩',
    space: '␣',
  };

  return keys
    .map((key) => {
      const lower = key.toLowerCase();
      return symbolMap[lower] || (key.length === 1 ? key.toUpperCase() : key);
    })
    .join('');
}

export const RecordingOverlay: React.FC<RecordingOverlayProps> = ({
  duration,
  screenshotCount,
  onStop,
  isDarkMode = false,
  audioLevel = 0,
  isVoiceActive = false,
  manualShortcut = 'CommandOrControl+Shift+S',
  toggleShortcut = 'CommandOrControl+Shift+F',
  pauseShortcut = 'CommandOrControl+Shift+P',
}) => {
  const [showBadge, setShowBadge] = useState(false);
  const [badgeKey, setBadgeKey] = useState(0);
  const [displayedMicPercent, setDisplayedMicPercent] = useState(0);

  const prevCountRef = useRef(screenshotCount);
  const micPercentTargetRef = useRef(0);
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

  // Format duration as MM:SS
  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

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

  // Dynamic styles based on theme
  const theme = {
    bg: isDarkMode
      ? 'rgba(12, 18, 30, 0.44)'
      : 'rgba(244, 247, 252, 0.42)',
    border: isDarkMode ? 'rgba(177, 192, 214, 0.22)' : 'rgba(95, 106, 121, 0.14)',
    text: isDarkMode ? '#f8fafc' : '#1f2937',
    textMuted: isDarkMode ? '#b7bfd2' : '#626d7d',
    hintBg: isDarkMode ? 'rgba(67, 77, 97, 0.22)' : 'rgba(218, 225, 235, 0.24)',
    stopBg: '#ff3b30',
    stopHover: '#d92f25',
    badgeBg: '#10b981',
    recordingDot: '#ef4444',
    micActive: '#0a84ff',
    micIdle: '#b6bbc6',
  };
  const manualShortcutText = formatCompactShortcut(manualShortcut, isMac);
  const toggleShortcutText = formatCompactShortcut(toggleShortcut, isMac);
  const pauseShortcutText = formatCompactShortcut(pauseShortcut, isMac);
  const normalizedAudioLevel = Math.max(0, Math.min(1, audioLevel));
  const visualAudioLevel = isVoiceActive
    ? Math.max(0.08, 1 - Math.exp(-normalizedAudioLevel * 2.4))
    : normalizedAudioLevel * 0.35;
  const micPercentTarget = isVoiceActive
    ? Math.min(96, Math.max(8, Math.round(visualAudioLevel * 100)))
    : 0;

  useEffect(() => {
    micPercentTargetRef.current = micPercentTarget;
  }, [micPercentTarget]);

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      setDisplayedMicPercent((previous) => {
        const target = micPercentTargetRef.current;
        const delta = target - previous;
        if (Math.abs(delta) < 1) {
          return target;
        }
        return previous + delta * 0.2;
      });
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      {/* Keyframe animations */}
      <style>
        {`
          @keyframes markupr-pulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.6;
              transform: scale(0.95);
            }
          }

          @keyframes markupr-badge-pop {
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

        `}
      </style>

      <div
        style={{
          position: 'fixed',
          left: '50%',
          top: 8,
          transform: 'translateX(-50%)',
          zIndex: 9999,
          display: 'grid',
          gap: 3,
          width: `min(${DEFAULT_WIDTH}px, calc(100vw - 16px))`,
          justifyItems: 'center',
          userSelect: 'none',
          transition: 'box-shadow 0.2s ease',
          // Electron-specific: prevent window drag
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties & { WebkitAppRegion?: string }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            width: '100%',
            padding: '3px 7px',
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            borderRadius: 999,
            boxShadow: '0 1px 2px rgba(8, 12, 19, 0.12)',
            backdropFilter: 'blur(24px) saturate(1.05)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.05)',
          }}
        >
          {/* Recording dot */}
          <div
            style={{
              position: 'relative',
              width: 10,
              height: 10,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                border: `2px solid ${theme.recordingDot}`,
                borderRadius: '50%',
                opacity: 0.25,
              }}
            />
            <div
              style={{
                position: 'relative',
                width: 10,
                height: 10,
                backgroundColor: theme.recordingDot,
                borderRadius: '50%',
                animation: 'markupr-pulse 1.5s ease-in-out infinite',
              }}
            />
          </div>

          {/* Duration display */}
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontSize: 11,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: theme.text,
              minWidth: 40,
              textAlign: 'center',
              letterSpacing: '0.02em',
            }}
          >
            {formatDuration(duration)}
          </span>

          {/* Live microphone indicator */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              borderRadius: 999,
              padding: '2px 5px',
              background: theme.hintBg,
              color: theme.textMuted,
              fontSize: 8,
              fontWeight: 600,
              minWidth: 78,
            }}
          >
            <CompactAudioIndicator
              audioLevel={visualAudioLevel}
              isVoiceActive={isVoiceActive}
              accentColor={theme.micActive}
              inactiveColor={theme.micIdle}
              barCount={11}
              barWidth={2.6}
              barGap={1.2}
              meterHeight={16}
              minBarHeight={4}
              maxBarHeight={16}
            />
            <span
              style={{
                color: isVoiceActive ? theme.text : theme.textMuted,
                fontVariantNumeric: 'tabular-nums',
                minWidth: 36,
                textAlign: 'right',
              }}
            >
              {isVoiceActive ? `${Math.round(displayedMicPercent)}%` : 'Mic'}
            </span>
          </div>

          {/* Screenshot count */}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 8,
              color: theme.textMuted,
              borderRadius: 999,
              padding: '2px 5px',
              background: theme.hintBg,
            }}
          >
            {screenshotCount} shot{screenshotCount === 1 ? '' : 's'}
          </span>

          {/* Stop button */}
          <button
            type="button"
            onClick={onStop}
            style={{
              padding: '3px 6px',
              backgroundColor: theme.stopBg,
              border: 'none',
              borderRadius: 9,
              color: '#ffffff',
              fontSize: 8.5,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              outline: 'none',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.stopHover;
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.stopBg;
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
          >
            Stop
          </button>
        </div>

        {/* Shortcut reminders */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 8,
            color: theme.textMuted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            width: '100%',
            justifyContent: 'center',
          }}
        >
          <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 999,
                padding: '1px 5px',
                background: theme.hintBg,
              }}
            >
            <strong style={{ fontWeight: 700 }}>Shot {manualShortcutText}</strong>
          </span>
          <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 999,
                padding: '1px 5px',
                background: theme.hintBg,
              }}
            >
            <strong style={{ fontWeight: 700 }}>Stop {toggleShortcutText}</strong>
          </span>
          <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 999,
                padding: '1px 5px',
                background: theme.hintBg,
              }}
            >
            <strong style={{ fontWeight: 700 }}>Pause {pauseShortcutText}</strong>
          </span>
        </div>

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
              animation: 'markupr-badge-pop 1.2s ease-out forwards',
              pointerEvents: 'none',
            }}
          >
            +1
          </span>
        )}
      </div>
    </>
  );
};

export default RecordingOverlay;
