import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { styles } from '../settings/settingsStyles';

export const KeyRecorder: React.FC<{
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  conflict?: string | null;
}> = ({ label, description, value, onChange, conflict }) => {
  const [recording, setRecording] = useState(false);
  const { colors } = useTheme();
  const inputRef = useRef<HTMLButtonElement>(null);
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

  const formatHotkey = useCallback((hotkey: string): string => {
    return hotkey
      .replace('CommandOrControl', isMac ? 'Cmd' : 'Ctrl')
      .replace('Command', 'Cmd')
      .replace('Control', 'Ctrl')
      .replace('Alt', isMac ? 'Option' : 'Alt')
      .replace('Shift', 'Shift')
      .replace(/\+/g, ' + ');
  }, [isMac]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;

      e.preventDefault();
      e.stopPropagation();

      const modifiers: string[] = [];
      if (e.metaKey || e.ctrlKey) modifiers.push('CommandOrControl');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');

      // Ignore modifier-only keys
      const key = e.key;
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
        return;
      }

      // Build hotkey string
      const hotkeyKey = key.length === 1 ? key.toUpperCase() : key;
      const hotkey = [...modifiers, hotkeyKey].join('+');

      onChange(hotkey);
      setRecording(false);
    },
    [recording, onChange]
  );

  useEffect(() => {
    if (recording) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [recording, handleKeyDown]);

  // Cancel recording on click outside
  useEffect(() => {
    if (!recording) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setRecording(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [recording]);

  return (
    <div style={styles.settingRow}>
      <div style={styles.settingInfo}>
        <span style={styles.settingLabel}>{label}</span>
        {description && <span style={styles.settingDescription}>{description}</span>}
        {conflict && (
          <span style={styles.conflictWarning}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 4.5v3M7 9.5h.005"
                stroke={colors.status.warning}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M6.134 1.944L1.06 10.5a1 1 0 00.866 1.5h10.148a1 1 0 00.866-1.5L7.866 1.944a1 1 0 00-1.732 0z"
                stroke={colors.status.warning}
                strokeWidth="1.5"
              />
            </svg>
            Conflicts with: {conflict}
          </span>
        )}
      </div>
      <button
        ref={inputRef}
        style={{
          ...styles.keyRecorder,
          borderColor: recording ? colors.accent.default : conflict ? colors.status.warning : colors.border.default,
          backgroundColor: recording ? colors.accent.subtle : colors.surface.inset,
        }}
        onClick={() => setRecording(true)}
      >
        {recording ? (
          <span style={styles.keyRecorderRecording}>Press keys...</span>
        ) : (
          <span style={styles.keyRecorderValue}>{formatHotkey(value)}</span>
        )}
      </button>
    </div>
  );
};
