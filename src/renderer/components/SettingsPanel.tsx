/**
 * markupr Settings Panel
 *
 * A comprehensive, native macOS-style settings experience with:
 * - Tabbed interface (General, Recording, Appearance, Hotkeys, Advanced)
 * - Live preview for theme and color changes
 * - Reset to defaults (per-section and global)
 * - Native folder dialog for output directory
 * - Visual key recorder with conflict detection
 * - Masked API key input with test connection
 *
 * Design: macOS System Preferences style with side tabs
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AppSettings, AudioDevice, HotkeyConfig } from '../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_HOTKEY_CONFIG } from '../../shared/types';
import { HotkeyHint } from './HotkeyHint';
import { TranscriptionTierSelector, type TranscriptionTier } from './TranscriptionTierSelector';
import { DonateButton } from './DonateButton';

// ============================================================================
// Types
// ============================================================================

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

type SettingsTab = 'general' | 'recording' | 'appearance' | 'hotkeys' | 'advanced';

interface ApiKeyState {
  value: string;
  visible: boolean;
  testing: boolean;
  valid: boolean | null;
  error: string | null;
}

// Accent color presets
const ACCENT_COLORS = [
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Red', value: '#EF4444' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Amber', value: '#F59E0B' },
  { name: 'Emerald', value: '#10B981' },
  { name: 'Teal', value: '#14B8A6' },
  { name: 'Cyan', value: '#06B6D4' },
];

// Tab configuration
const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 12a2 2 0 100-4 2 2 0 000 4z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M16.472 12.111a1.5 1.5 0 00.3 1.655l.054.055a1.818 1.818 0 11-2.572 2.572l-.055-.055a1.5 1.5 0 00-1.655-.3 1.5 1.5 0 00-.909 1.373v.153a1.818 1.818 0 11-3.636 0v-.082a1.5 1.5 0 00-.982-1.371 1.5 1.5 0 00-1.655.3l-.055.054a1.818 1.818 0 11-2.572-2.572l.055-.055a1.5 1.5 0 00.3-1.655 1.5 1.5 0 00-1.373-.909h-.153a1.818 1.818 0 110-3.636h.082a1.5 1.5 0 001.371-.982 1.5 1.5 0 00-.3-1.655l-.054-.055a1.818 1.818 0 112.572-2.572l.055.055a1.5 1.5 0 001.655.3h.073a1.5 1.5 0 00.909-1.373v-.153a1.818 1.818 0 013.636 0v.082a1.5 1.5 0 00.909 1.371 1.5 1.5 0 001.655-.3l.055-.054a1.818 1.818 0 112.572 2.572l-.055.055a1.5 1.5 0 00-.3 1.655v.073a1.5 1.5 0 001.373.909h.153a1.818 1.818 0 010 3.636h-.082a1.5 1.5 0 00-1.371.909z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'recording',
    label: 'Recording',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M3 10a7 7 0 1014 0 7 7 0 00-14 0z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M10 3v14M3 10h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'hotkeys',
    label: 'Hotkeys',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect
          x="2"
          y="5"
          width="16"
          height="10"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M5 8h2M8 8h2M11 8h2M14 8h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 11h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M4 5h12M4 10h12M4 15h12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="8" cy="5" r="1.5" fill="currentColor" />
        <circle cx="14" cy="10" r="1.5" fill="currentColor" />
        <circle cx="6" cy="15" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Settings Section with header and optional reset button
 */
const SettingsSection: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
  onReset?: () => void;
}> = ({ title, description, children, onReset }) => (
  <div style={styles.section}>
    <div style={styles.sectionHeader}>
      <div>
        <h3 style={styles.sectionTitle}>{title}</h3>
        {description && <p style={styles.sectionDescription}>{description}</p>}
      </div>
      {onReset && (
        <button style={styles.resetSectionButton} onClick={onReset} title="Reset section to defaults">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1.75 7a5.25 5.25 0 109.006-3.668M7 3.5V1.75L9.625 4.375 7 7"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
    <div style={styles.sectionContent}>{children}</div>
  </div>
);

/**
 * Toggle Switch Setting
 */
const ToggleSetting: React.FC<{
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}> = ({ label, description, value, onChange, disabled }) => (
  <div style={styles.settingRow}>
    <div style={styles.settingInfo}>
      <span style={styles.settingLabel}>{label}</span>
      {description && <span style={styles.settingDescription}>{description}</span>}
    </div>
    <button
      style={{
        ...styles.toggle,
        backgroundColor: value ? 'var(--ff-accent)' : '#374151',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      role="switch"
      aria-checked={value}
    >
      <span
        style={{
          ...styles.toggleKnob,
          transform: value ? 'translateX(18px)' : 'translateX(2px)',
        }}
      />
    </button>
  </div>
);

/**
 * Dropdown Select Setting
 */
const DropdownSetting: React.FC<{
  label: string;
  description?: string;
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange: (value: string | number) => void;
  disabled?: boolean;
}> = ({ label, description, value, options, onChange, disabled }) => (
  <div style={styles.settingRow}>
    <div style={styles.settingInfo}>
      <span style={styles.settingLabel}>{label}</span>
      {description && <span style={styles.settingDescription}>{description}</span>}
    </div>
    <select
      style={{
        ...styles.select,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

/**
 * Slider Setting with live value display
 */
const SliderSetting: React.FC<{
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  formatValue?: (value: number) => string;
}> = ({ label, description, value, min, max, step, unit = '', onChange, disabled, formatValue }) => {
  const displayValue = formatValue ? formatValue(value) : `${value}${unit}`;

  return (
    <div style={styles.settingRow}>
      <div style={styles.settingInfo}>
        <span style={styles.settingLabel}>{label}</span>
        {description && <span style={styles.settingDescription}>{description}</span>}
      </div>
      <div style={styles.sliderContainer}>
        <span style={styles.sliderValue}>{displayValue}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          style={{
            ...styles.slider,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      </div>
    </div>
  );
};

/**
 * Directory Picker Setting
 */
const DirectoryPicker: React.FC<{
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, description, value, onChange }) => {
  const handleBrowse = useCallback(async () => {
    try {
      const result = await window.feedbackflow.settings.selectDirectory();
      if (result) {
        onChange(result);
      }
    } catch {
      // User cancelled or error
    }
  }, [onChange]);

  return (
    <div style={styles.settingRow}>
      <div style={styles.settingInfo}>
        <span style={styles.settingLabel}>{label}</span>
        {description && <span style={styles.settingDescription}>{description}</span>}
      </div>
      <div style={styles.directoryPicker}>
        <input
          type="text"
          value={value}
          readOnly
          style={styles.directoryInput}
          placeholder="Select output directory..."
        />
        <button style={styles.browseButton} onClick={handleBrowse}>
          Browse...
        </button>
      </div>
    </div>
  );
};

/**
 * Key Recorder for hotkey customization
 */
const KeyRecorder: React.FC<{
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  conflict?: string | null;
}> = ({ label, description, value, onChange, conflict }) => {
  const [recording, setRecording] = useState(false);
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
                stroke="#F59E0B"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M6.134 1.944L1.06 10.5a1 1 0 00.866 1.5h10.148a1 1 0 00.866-1.5L7.866 1.944a1 1 0 00-1.732 0z"
                stroke="#F59E0B"
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
          borderColor: recording ? '#3B82F6' : conflict ? '#F59E0B' : '#374151',
          backgroundColor: recording ? 'rgba(59, 130, 246, 0.1)' : 'rgba(31, 41, 55, 0.8)',
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

/**
 * Color Picker with preset colors
 */
const ColorPicker: React.FC<{
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, description, value, onChange }) => {
  const [customColor, setCustomColor] = useState(value);

  const isPreset = ACCENT_COLORS.some((c) => c.value === value);

  return (
    <div style={styles.settingRowVertical}>
      <div style={styles.settingInfo}>
        <span style={styles.settingLabel}>{label}</span>
        {description && <span style={styles.settingDescription}>{description}</span>}
      </div>
      <div style={styles.colorPickerContainer}>
        {ACCENT_COLORS.map((color) => (
          <button
            key={color.value}
            style={{
              ...styles.colorSwatch,
              backgroundColor: color.value,
              boxShadow: value === color.value ? `0 0 0 2px #111827, 0 0 0 4px ${color.value}` : 'none',
            }}
            onClick={() => onChange(color.value)}
            title={color.name}
            aria-label={`Select ${color.name} accent color`}
          />
        ))}
        <div style={styles.customColorContainer}>
          <input
            type="color"
            value={isPreset ? customColor : value}
            onChange={(e) => {
              setCustomColor(e.target.value);
              onChange(e.target.value);
            }}
            style={styles.customColorInput}
            title="Custom color"
          />
          <span style={styles.customColorLabel}>Custom</span>
        </div>
      </div>
    </div>
  );
};

/**
 * API Key Input with show/hide and test button
 */
const ApiKeyInput: React.FC<{
  label: string;
  description?: string;
  serviceName: string;
  apiKey: ApiKeyState;
  onApiKeyChange: (value: string) => void;
  onToggleVisibility: () => void;
  onTest: () => void;
}> = ({ label, description, serviceName, apiKey, onApiKeyChange, onToggleVisibility, onTest }) => (
  <div style={styles.settingRowVertical}>
    <div style={styles.settingInfo}>
      <span style={styles.settingLabel}>{label}</span>
      {description && <span style={styles.settingDescription}>{description}</span>}
    </div>
    <div style={styles.apiKeyContainer}>
      <div style={styles.apiKeyInputWrapper}>
        <input
          type={apiKey.visible ? 'text' : 'password'}
          value={apiKey.value}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={`Enter your ${serviceName} API key`}
          style={{
            ...styles.apiKeyInput,
            borderColor: apiKey.error ? '#EF4444' : apiKey.valid ? '#10B981' : '#374151',
          }}
        />
        <button style={styles.apiKeyVisibilityButton} onClick={onToggleVisibility} title={apiKey.visible ? 'Hide' : 'Show'}>
          {apiKey.visible ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M2.636 9.364S4.91 5.182 9 5.182s6.364 4.182 6.364 4.182-2.273 4.182-6.364 4.182-6.364-4.182-6.364-4.182z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M2 2l14 14M7.455 7.455a2 2 0 002.828 2.828M14.182 10.727c.6-.527.975-.961 1.182-1.363-1.636-3.273-4.364-5.182-6.364-5.182-.545 0-1.09.127-1.636.382M3.818 5.273C2.818 6.073 2.273 6.909 2 7.636c1.636 3.273 4.364 5.182 6.364 5.182.818 0 1.636-.255 2.454-.727"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </div>
      <button
        style={{
          ...styles.apiKeyTestButton,
          backgroundColor: apiKey.testing ? '#374151' : apiKey.valid ? '#10B981' : '#3B82F6',
          cursor: apiKey.testing || !apiKey.value ? 'not-allowed' : 'pointer',
          opacity: !apiKey.value ? 0.5 : 1,
        }}
        onClick={onTest}
        disabled={apiKey.testing || !apiKey.value}
      >
        {apiKey.testing ? (
          <span style={styles.spinner} />
        ) : apiKey.valid ? (
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 7l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Verified
          </>
        ) : (
          'Test Connection'
        )}
      </button>
    </div>
    {apiKey.error && <span style={styles.apiKeyError}>{apiKey.error}</span>}
    {apiKey.valid && <span style={styles.apiKeySuccess}>API key verified and saved securely.</span>}
  </div>
);

/**
 * Danger Zone Button (for destructive actions)
 */
const DangerButton: React.FC<{
  label: string;
  description?: string;
  buttonText: string;
  onConfirm: () => void;
  confirmText?: string;
}> = ({ label, description, buttonText, onConfirm, confirmText }) => {
  const [confirming, setConfirming] = useState(false);

  const handleClick = useCallback(() => {
    if (confirming) {
      onConfirm();
      setConfirming(false);
    } else {
      setConfirming(true);
      // Auto-reset after 3 seconds
      setTimeout(() => setConfirming(false), 3000);
    }
  }, [confirming, onConfirm]);

  return (
    <div style={styles.settingRow}>
      <div style={styles.settingInfo}>
        <span style={styles.settingLabel}>{label}</span>
        {description && <span style={styles.settingDescription}>{description}</span>}
      </div>
      <button
        style={{
          ...styles.dangerButton,
          backgroundColor: confirming ? '#DC2626' : 'rgba(239, 68, 68, 0.1)',
          color: confirming ? '#ffffff' : '#F87171',
          borderColor: confirming ? '#DC2626' : 'rgba(239, 68, 68, 0.3)',
        }}
        onClick={handleClick}
      >
        {confirming ? confirmText || 'Click again to confirm' : buttonText}
      </button>
    </div>
  );
};

// ============================================================================
// Tab Content Components
// ============================================================================

/**
 * General Tab
 */
const GeneralTab: React.FC<{
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onResetSection: () => void;
}> = ({ settings, onSettingChange, onResetSection }) => (
  <div style={styles.tabContent}>
    <SettingsSection
      title="Output"
      description="Where your feedback sessions are saved"
      onReset={onResetSection}
    >
      <DirectoryPicker
        label="Output Directory"
        description="Screenshots and markdown files will be saved here"
        value={settings.outputDirectory}
        onChange={(value) => onSettingChange('outputDirectory', value)}
      />
    </SettingsSection>

    <SettingsSection title="Startup">
      <ToggleSetting
        label="Launch at Login"
        description="Start markupr automatically when you log in"
        value={settings.launchAtLogin}
        onChange={(value) => onSettingChange('launchAtLogin', value)}
      />
      <ToggleSetting
        label="Check for Updates"
        description="Automatically check for new versions"
        value={settings.checkForUpdates}
        onChange={(value) => onSettingChange('checkForUpdates', value)}
      />
    </SettingsSection>
  </div>
);

/**
 * Recording Tab
 */
const RecordingTab: React.FC<{
  settings: AppSettings;
  audioDevices: AudioDevice[];
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onResetSection: () => void;
}> = ({ settings, audioDevices, onSettingChange, onResetSection }) => (
  <div style={styles.tabContent}>
    <SettingsSection
      title="Recording Behavior"
      description="Customize how recording sessions work"
      onReset={onResetSection}
    >
      <DropdownSetting
        label="Countdown Before Recording"
        description="Give yourself time to prepare"
        value={settings.defaultCountdown}
        options={[
          { value: 0, label: 'No countdown' },
          { value: 3, label: '3 seconds' },
          { value: 5, label: '5 seconds' },
        ]}
        onChange={(value) => onSettingChange('defaultCountdown', Number(value) as 0 | 3 | 5)}
      />
      <ToggleSetting
        label="Show Transcription Preview"
        description="Display live transcription during recording"
        value={settings.showTranscriptionPreview}
        onChange={(value) => onSettingChange('showTranscriptionPreview', value)}
      />
      <ToggleSetting
        label="Show Audio Waveform"
        description="Visual feedback of your voice levels"
        value={settings.showAudioWaveform}
        onChange={(value) => onSettingChange('showAudioWaveform', value)}
      />
    </SettingsSection>

    <SettingsSection title="Audio Input">
      <DropdownSetting
        label="Microphone"
        description="Select which microphone to use for voice capture"
        value={settings.audioDeviceId || 'default'}
        options={[
          { value: 'default', label: 'System Default' },
          ...audioDevices.map((device) => ({
            value: device.id,
            label: device.name + (device.isDefault ? ' (Default)' : ''),
          })),
        ]}
        onChange={(value) => onSettingChange('audioDeviceId', value === 'default' ? null : String(value))}
      />
    </SettingsSection>

    <SettingsSection title="Screenshot Timing">
      <SliderSetting
        label="Pause Threshold"
        description="How long to pause before capturing a screenshot"
        value={settings.pauseThreshold}
        min={500}
        max={3000}
        step={100}
        unit="ms"
        formatValue={(v) => `${(v / 1000).toFixed(1)}s`}
        onChange={(value) => onSettingChange('pauseThreshold', value)}
      />
      <SliderSetting
        label="Minimum Time Between Captures"
        description="Prevent too many screenshots in quick succession"
        value={settings.minTimeBetweenCaptures}
        min={300}
        max={2000}
        step={100}
        unit="ms"
        formatValue={(v) => `${(v / 1000).toFixed(1)}s`}
        onChange={(value) => onSettingChange('minTimeBetweenCaptures', value)}
      />
    </SettingsSection>
  </div>
);

/**
 * Appearance Tab
 */
const AppearanceTab: React.FC<{
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onResetSection: () => void;
}> = ({ settings, onSettingChange, onResetSection }) => (
  <div style={styles.tabContent}>
    <SettingsSection
      title="Theme"
      description="Choose how markupr looks"
      onReset={onResetSection}
    >
      <DropdownSetting
        label="Theme Mode"
        description="Match your system or choose a specific theme"
        value={settings.theme}
        options={[
          { value: 'system', label: 'System' },
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        onChange={(value) => onSettingChange('theme', value as 'system' | 'dark' | 'light')}
      />
    </SettingsSection>

    <SettingsSection title="Accent Color">
      <ColorPicker
        label="Accent Color"
        description="Used for buttons, links, and highlights"
        value={settings.accentColor}
        onChange={(value) => onSettingChange('accentColor', value)}
      />
    </SettingsSection>

    {/* Live Preview */}
    <SettingsSection title="Preview">
      <div style={styles.themePreview}>
        <div
          style={{
            ...styles.previewCard,
            backgroundColor: settings.theme === 'light' ? '#ffffff' : 'rgba(17, 24, 39, 0.95)',
            borderColor: settings.theme === 'light' ? '#e5e7eb' : 'rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={styles.previewHeader}>
            <div style={{ ...styles.previewDot, backgroundColor: settings.accentColor }} />
            <span
              style={{
                ...styles.previewTitle,
                color: settings.theme === 'light' ? '#1f2937' : '#f9fafb',
              }}
            >
              Recording Session
            </span>
          </div>
          <button
            style={{
              ...styles.previewButton,
              backgroundColor: settings.accentColor,
            }}
          >
            Start Recording
          </button>
        </div>
      </div>
    </SettingsSection>
  </div>
);

/**
 * Hotkeys Tab
 */
const HotkeysTab: React.FC<{
  settings: AppSettings;
  onHotkeyChange: (key: keyof HotkeyConfig, value: string) => void;
  onResetSection: () => void;
}> = ({ settings, onHotkeyChange, onResetSection }) => {
  // Detect conflicts
  const findConflict = useCallback(
    (currentKey: keyof HotkeyConfig, value: string): string | null => {
      const entries = Object.entries(settings.hotkeys) as [keyof HotkeyConfig, string][];
      for (const [key, hotkey] of entries) {
        if (key !== currentKey && hotkey === value) {
          const labels: Record<keyof HotkeyConfig, string> = {
            toggleRecording: 'Start/Stop Recording',
            manualScreenshot: 'Manual Screenshot',
          };
          return labels[key];
        }
      }
      return null;
    },
    [settings.hotkeys]
  );

  return (
    <div style={styles.tabContent}>
      <SettingsSection
        title="Keyboard Shortcuts"
        description="Customize global hotkeys for markupr"
        onReset={onResetSection}
      >
        <KeyRecorder
          label="Start/Stop Recording"
          description="Toggle recording on and off"
          value={settings.hotkeys.toggleRecording}
          onChange={(value) => onHotkeyChange('toggleRecording', value)}
          conflict={findConflict('toggleRecording', settings.hotkeys.toggleRecording)}
        />
        <KeyRecorder
          label="Manual Screenshot"
          description="Capture a screenshot immediately"
          value={settings.hotkeys.manualScreenshot}
          onChange={(value) => onHotkeyChange('manualScreenshot', value)}
          conflict={findConflict('manualScreenshot', settings.hotkeys.manualScreenshot)}
        />
      </SettingsSection>

      <SettingsSection title="Quick Reference">
        <div style={styles.hotkeyReference}>
          <div style={styles.hotkeyRefItem}>
            <span style={styles.hotkeyRefLabel}>Start/Stop Recording</span>
            <HotkeyHint keys={settings.hotkeys.toggleRecording} size="medium" />
          </div>
          <div style={styles.hotkeyRefItem}>
            <span style={styles.hotkeyRefLabel}>Manual Screenshot</span>
            <HotkeyHint keys={settings.hotkeys.manualScreenshot} size="medium" />
          </div>
        </div>
      </SettingsSection>
    </div>
  );
};

/**
 * Advanced Tab
 */
const AdvancedTab: React.FC<{
  settings: AppSettings;
  apiKey: ApiKeyState;
  currentTier: TranscriptionTier | null;
  onTierSelect: (tier: TranscriptionTier) => void;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onApiKeyChange: (value: string) => void;
  onToggleApiKeyVisibility: () => void;
  onTestApiKey: () => void;
  onClearAllData: () => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
  onResetSection: () => void;
}> = ({
  settings,
  apiKey,
  currentTier,
  onTierSelect,
  onSettingChange,
  onApiKeyChange,
  onToggleApiKeyVisibility,
  onTestApiKey,
  onClearAllData,
  onExportSettings,
  onImportSettings,
  onResetSection,
}) => (
  <div style={styles.tabContent}>
    {/* Transcription Tier Selection */}
    <SettingsSection
      title="Transcription"
      description="Choose your transcription service"
      onReset={onResetSection}
    >
      <TranscriptionTierSelector
        currentTier={currentTier}
        onTierSelect={onTierSelect}
        compact={false}
      />
    </SettingsSection>

    {/* Deepgram API Key (Optional - for premium tier) */}
    <SettingsSection
      title="Deepgram API Key (Optional)"
      description="Add an API key to enable premium cloud transcription"
    >
      <div style={styles.serviceInfo}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            stroke="#8B5CF6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div>
          <span style={styles.serviceName}>Deepgram Nova-3</span>
          <span style={styles.serviceDescription}>
            Best quality cloud transcription. Free tier: 200 hours/month at{' '}
            <a href="https://deepgram.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3B82F6' }}>
              deepgram.com
            </a>
          </span>
        </div>
      </div>
      <ApiKeyInput
        label="API Key"
        description="Optional - leave blank to use local Whisper"
        serviceName="Deepgram"
        apiKey={apiKey}
        onApiKeyChange={onApiKeyChange}
        onToggleVisibility={onToggleApiKeyVisibility}
        onTest={onTestApiKey}
      />
    </SettingsSection>

    <SettingsSection title="Debug & Backup">
      <ToggleSetting
        label="Debug Mode"
        description="Enable verbose logging for troubleshooting"
        value={settings.debugMode}
        onChange={(value) => onSettingChange('debugMode', value)}
      />
      <ToggleSetting
        label="Keep Audio Backups"
        description="Save audio recordings alongside transcriptions"
        value={settings.keepAudioBackups}
        onChange={(value) => onSettingChange('keepAudioBackups', value)}
      />
    </SettingsSection>

    <SettingsSection title="Settings Management">
      <div style={styles.settingRow}>
        <div style={styles.settingInfo}>
          <span style={styles.settingLabel}>Export Settings</span>
          <span style={styles.settingDescription}>Save your settings to a file</span>
        </div>
        <button style={styles.secondaryButton} onClick={onExportSettings}>
          Export
        </button>
      </div>
      <div style={styles.settingRow}>
        <div style={styles.settingInfo}>
          <span style={styles.settingLabel}>Import Settings</span>
          <span style={styles.settingDescription}>Load settings from a file</span>
        </div>
        <button style={styles.secondaryButton} onClick={onImportSettings}>
          Import
        </button>
      </div>
    </SettingsSection>

    <SettingsSection title="Danger Zone">
      <DangerButton
        label="Clear All Data"
        description="Delete all sessions, screenshots, and reset settings"
        buttonText="Clear All Data"
        confirmText="Click to confirm deletion"
        onConfirm={onClearAllData}
      />
    </SettingsSection>
  </div>
);

// ============================================================================
// Main Settings Panel Component
// ============================================================================

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  initialTab = 'general',
}) => {
  // State
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [apiKey, setApiKey] = useState<ApiKeyState>({
    value: '',
    visible: false,
    testing: false,
    valid: null,
    error: null,
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [currentTier, setCurrentTier] = useState<TranscriptionTier | null>('whisper');
  const [appVersion, setAppVersion] = useState('');
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 760
  );

  const panelRef = useRef<HTMLDivElement>(null);

  // Load settings on mount
  useEffect(() => {
    if (!isOpen) return;

    const loadSettings = async () => {
      try {
        // Load settings
        const allSettings = await window.feedbackflow.settings.getAll();
        setSettings({ ...DEFAULT_SETTINGS, ...allSettings });

        // Load audio devices
        const devices = await window.feedbackflow.audio.getDevices();
        setAudioDevices(devices);

        // Check if API key exists (we won't show the actual value for security)
        try {
          const hasKey = await window.feedbackflow.settings.hasApiKey('deepgram');
          if (hasKey) {
            setApiKey((prev) => ({ ...prev, value: '********', valid: true }));
          }
        } catch {
          // No API key stored
        }

        // Load current transcription tier
        try {
          const tier = await window.feedbackflow.transcription.getCurrentTier();
          if (tier && tier !== 'auto') {
            setCurrentTier(tier as TranscriptionTier);
          }
        } catch {
          // Default to whisper
          setCurrentTier('whisper');
        }

        // Load app version
        try {
          const ver = await window.feedbackflow.version();
          setAppVersion(ver);
        } catch {
          setAppVersion('');
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    };

    loadSettings();
  }, [isOpen]);

  // Handle setting changes with immediate save
  const handleSettingChange = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setHasChanges(true);

      // Save immediately
      try {
        await window.feedbackflow.settings.set(key, value);
      } catch (error) {
        console.error('Failed to save setting:', error);
      }
    },
    []
  );

  // Handle hotkey changes
  const handleHotkeyChange = useCallback(
    async (key: keyof HotkeyConfig, value: string) => {
      const newHotkeys = { ...settings.hotkeys, [key]: value };
      setSettings((prev) => ({ ...prev, hotkeys: newHotkeys }));
      setHasChanges(true);

      try {
        await window.feedbackflow.settings.set('hotkeys', newHotkeys);
        // Re-register hotkeys
        await window.feedbackflow.hotkeys.updateConfig(newHotkeys);
      } catch (error) {
        console.error('Failed to update hotkey:', error);
      }
    },
    [settings.hotkeys]
  );

  // API key handlers
  const handleApiKeyChange = useCallback((value: string) => {
    setApiKey((prev) => ({ ...prev, value, valid: null, error: null }));
  }, []);

  const handleToggleApiKeyVisibility = useCallback(() => {
    setApiKey((prev) => ({ ...prev, visible: !prev.visible }));
  }, []);

  const handleTestApiKey = useCallback(async () => {
    setApiKey((prev) => ({ ...prev, testing: true, error: null }));

    try {
      const response = await fetch('https://api.deepgram.com/v1/projects', {
        method: 'GET',
        headers: {
          Authorization: `Token ${apiKey.value}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // Save the API key securely
        await window.feedbackflow.settings.setApiKey('deepgram', apiKey.value);
        setApiKey((prev) => ({ ...prev, testing: false, valid: true }));
      } else if (response.status === 401) {
        setApiKey((prev) => ({
          ...prev,
          testing: false,
          valid: false,
          error: 'Invalid API key. Please check and try again.',
        }));
      } else {
        setApiKey((prev) => ({
          ...prev,
          testing: false,
          valid: false,
          error: `API error (${response.status}). Please try again.`,
        }));
      }
    } catch {
      setApiKey((prev) => ({
        ...prev,
        testing: false,
        valid: false,
        error: 'Network error. Please check your connection.',
      }));
    }
  }, [apiKey.value]);

  // Transcription tier selection handler
  const handleTierSelect = useCallback(async (tier: TranscriptionTier) => {
    try {
      const result = await window.feedbackflow.transcription.setTier(tier);
      if (!result.success) {
        throw new Error(result.error || 'Unable to switch transcription tier.');
      }

      setCurrentTier(tier);
      setHasChanges(true);
    } catch (error) {
      console.error('Failed to set transcription tier:', error);
    }
  }, []);

  // Reset handlers
  const resetGeneralSection = useCallback(async () => {
    const defaults = {
      outputDirectory: DEFAULT_SETTINGS.outputDirectory,
      launchAtLogin: DEFAULT_SETTINGS.launchAtLogin,
      checkForUpdates: DEFAULT_SETTINGS.checkForUpdates,
    };

    setSettings((prev) => ({ ...prev, ...defaults }));

    for (const [key, value] of Object.entries(defaults)) {
      await window.feedbackflow.settings.set(key as keyof AppSettings, value);
    }
  }, []);

  const resetRecordingSection = useCallback(async () => {
    const defaults = {
      defaultCountdown: DEFAULT_SETTINGS.defaultCountdown,
      showTranscriptionPreview: DEFAULT_SETTINGS.showTranscriptionPreview,
      showAudioWaveform: DEFAULT_SETTINGS.showAudioWaveform,
      audioDeviceId: DEFAULT_SETTINGS.audioDeviceId,
      pauseThreshold: DEFAULT_SETTINGS.pauseThreshold,
      minTimeBetweenCaptures: DEFAULT_SETTINGS.minTimeBetweenCaptures,
    };

    setSettings((prev) => ({ ...prev, ...defaults }));

    for (const [key, value] of Object.entries(defaults)) {
      await window.feedbackflow.settings.set(key as keyof AppSettings, value);
    }
  }, []);

  const resetAppearanceSection = useCallback(async () => {
    const defaults = {
      theme: DEFAULT_SETTINGS.theme,
      accentColor: DEFAULT_SETTINGS.accentColor,
    };

    setSettings((prev) => ({ ...prev, ...defaults }));

    for (const [key, value] of Object.entries(defaults)) {
      await window.feedbackflow.settings.set(key as keyof AppSettings, value);
    }
  }, []);

  const resetHotkeysSection = useCallback(async () => {
    const defaults = { ...DEFAULT_HOTKEY_CONFIG };
    setSettings((prev) => ({ ...prev, hotkeys: defaults }));
    await window.feedbackflow.settings.set('hotkeys', defaults);
    // @ts-expect-error - update may be named updateConfig in type definition
    await (window.feedbackflow.hotkeys.update ?? window.feedbackflow.hotkeys.updateConfig)?.(defaults);
  }, []);

  const resetAdvancedSection = useCallback(async () => {
    const defaults = {
      debugMode: DEFAULT_SETTINGS.debugMode,
      keepAudioBackups: DEFAULT_SETTINGS.keepAudioBackups,
    };

    setSettings((prev) => ({ ...prev, ...defaults }));

    for (const [key, value] of Object.entries(defaults)) {
      await window.feedbackflow.settings.set(key as keyof AppSettings, value);
    }
  }, []);

  // Data management handlers
  const handleClearAllData = useCallback(async () => {
    try {
      await window.feedbackflow.settings.clearAllData();
      setSettings(DEFAULT_SETTINGS);
      setApiKey({ value: '', visible: false, testing: false, valid: null, error: null });
    } catch (error) {
      console.error('Failed to clear data:', error);
    }
  }, []);

  const handleExportSettings = useCallback(async () => {
    try {
      await window.feedbackflow.settings.export();
    } catch (error) {
      console.error('Failed to export settings:', error);
    }
  }, []);

  const handleImportSettings = useCallback(async () => {
    try {
      const imported = await window.feedbackflow.settings.import();
      if (imported) {
        setSettings({ ...DEFAULT_SETTINGS, ...imported });
      }
    } catch (error) {
      console.error('Failed to import settings:', error);
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Animation on open/close
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Responsive layout for narrow popover widths
  useEffect(() => {
    const onResize = () => {
      setIsCompact(window.innerWidth < 760);
    };

    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Render tab content
  const renderTabContent = useMemo(() => {
    switch (activeTab) {
      case 'general':
        return (
          <GeneralTab
            settings={settings}
            onSettingChange={handleSettingChange}
            onResetSection={resetGeneralSection}
          />
        );
      case 'recording':
        return (
          <RecordingTab
            settings={settings}
            audioDevices={audioDevices}
            onSettingChange={handleSettingChange}
            onResetSection={resetRecordingSection}
          />
        );
      case 'appearance':
        return (
          <AppearanceTab
            settings={settings}
            onSettingChange={handleSettingChange}
            onResetSection={resetAppearanceSection}
          />
        );
      case 'hotkeys':
        return (
          <HotkeysTab
            settings={settings}
            onHotkeyChange={handleHotkeyChange}
            onResetSection={resetHotkeysSection}
          />
        );
      case 'advanced':
        return (
          <AdvancedTab
            settings={settings}
            apiKey={apiKey}
            currentTier={currentTier}
            onTierSelect={handleTierSelect}
            onSettingChange={handleSettingChange}
            onApiKeyChange={handleApiKeyChange}
            onToggleApiKeyVisibility={handleToggleApiKeyVisibility}
            onTestApiKey={handleTestApiKey}
            onClearAllData={handleClearAllData}
            onExportSettings={handleExportSettings}
            onImportSettings={handleImportSettings}
            onResetSection={resetAdvancedSection}
          />
        );
      default:
        return null;
    }
  }, [
    activeTab,
    settings,
    audioDevices,
    apiKey,
    currentTier,
    handleSettingChange,
    handleHotkeyChange,
    handleTierSelect,
    handleApiKeyChange,
    handleToggleApiKeyVisibility,
    handleTestApiKey,
    handleClearAllData,
    handleExportSettings,
    handleImportSettings,
    resetGeneralSection,
    resetRecordingSection,
    resetAppearanceSection,
    resetHotkeysSection,
    resetAdvancedSection,
  ]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.backdrop} onClick={onClose} />

      <div
        ref={panelRef}
        style={{
          ...styles.panel,
          opacity: isAnimating ? 0 : 1,
          transform: isAnimating ? 'scale(0.95) translateY(10px)' : 'scale(1) translateY(0)',
        }}
      >
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.headerTitle}>Settings</h2>
          <button style={styles.closeButton} onClick={onClose} aria-label="Close settings">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 5l10 10M15 5l-10 10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            ...styles.content,
            flexDirection: isCompact ? 'column' : 'row',
          }}
        >
          {/* Side Tabs */}
          <nav
            style={{
              ...styles.sidebar,
              ...(isCompact ? styles.sidebarCompact : {}),
            }}
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                style={{
                  ...styles.tabButton,
                  ...(isCompact ? styles.tabButtonCompact : {}),
                  backgroundColor: activeTab === tab.id ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                  color: activeTab === tab.id ? '#3B82F6' : '#9ca3af',
                  borderColor: activeTab === tab.id ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                }}
                onClick={() => setActiveTab(tab.id)}
                aria-selected={activeTab === tab.id}
              >
                {tab.icon}
                <span style={styles.tabLabel}>{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Tab Content */}
          <div
            style={{
              ...styles.tabPanel,
              ...(isCompact ? styles.tabPanelCompact : {}),
            }}
          >
            {renderTabContent}
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <div style={styles.footerLeft}>
            <span style={styles.footerText}>
              markupr {appVersion ? `v${appVersion}` : ''} {hasChanges && <span style={styles.savedIndicator}>Changes saved</span>}
            </span>
            <DonateButton />
          </div>
          <button
            style={styles.resetAllButton}
            onClick={async () => {
              await resetGeneralSection();
              await resetRecordingSection();
              await resetAppearanceSection();
              await resetHotkeysSection();
              await resetAdvancedSection();
            }}
          >
            Reset All to Defaults
          </button>
        </div>
      </div>

      {/* Keyframe animations */}
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }

          input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #3B82F6;
            cursor: pointer;
            border: 2px solid #1f2937;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          }

          input[type="range"]::-webkit-slider-runnable-track {
            width: 100%;
            height: 4px;
            background: #374151;
            border-radius: 2px;
          }

          select {
            -webkit-appearance: none;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 12px center;
            padding-right: 36px;
          }

          select:focus {
            outline: none;
            border-color: #3B82F6;
          }

          input[type="color"] {
            -webkit-appearance: none;
            appearance: none;
            border: none;
            width: 32px;
            height: 32px;
            padding: 0;
            cursor: pointer;
          }

          input[type="color"]::-webkit-color-swatch-wrapper {
            padding: 0;
          }

          input[type="color"]::-webkit-color-swatch {
            border: none;
            border-radius: 50%;
          }
        `}
      </style>
    </div>
  );
};

// ============================================================================
// Styles
// ============================================================================

type ExtendedCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const styles: Record<string, ExtendedCSSProperties> = {
  // Overlay & Panel
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: 12,
  },

  backdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
  },

  panel: {
    position: 'relative',
    width: '100%',
    maxWidth: 940,
    maxHeight: '92vh',
    backgroundColor: 'rgba(249, 249, 251, 0.98)',
    borderRadius: 16,
    boxShadow: '0 24px 56px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(60, 60, 67, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    WebkitAppRegion: 'no-drag',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px',
    borderBottom: '1px solid rgba(60, 60, 67, 0.2)',
    WebkitAppRegion: 'drag',
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1d1d1f',
    margin: 0,
  },

  closeButton: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 8,
    color: '#6e6e73',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    WebkitAppRegion: 'no-drag',
  },

  // Content
  content: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  },

  // Sidebar
  sidebar: {
    width: 200,
    padding: '16px 12px',
    borderRight: '1px solid rgba(60, 60, 67, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flexShrink: 0,
  },

  sidebarCompact: {
    width: '100%',
    borderRight: 'none',
    borderBottom: '1px solid rgba(60, 60, 67, 0.2)',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: '12px',
  },

  tabButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '10px 12px',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    borderRadius: 8,
    color: '#6e6e73',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textAlign: 'left',
  },

  tabButtonCompact: {
    width: 'auto',
    flex: '1 1 calc(50% - 6px)',
    justifyContent: 'center',
  },

  tabLabel: {
    flex: 1,
  },

  // Tab Panel
  tabPanel: {
    flex: 1,
    overflow: 'auto',
    padding: 24,
    minHeight: 0,
  },

  tabPanelCompact: {
    padding: 16,
  },

  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
  },

  // Section
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },

  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },

  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#3a3a3c',
    margin: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  sectionDescription: {
    fontSize: 13,
    color: '#6e6e73',
    marginTop: 2,
  },

  sectionContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    padding: 16,
    border: '1px solid rgba(60, 60, 67, 0.18)',
  },

  resetSectionButton: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    border: '1px solid rgba(60, 60, 67, 0.3)',
    borderRadius: 6,
    color: '#6e6e73',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    flexShrink: 0,
  },

  // Setting Row
  settingRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 40,
    flexWrap: 'wrap',
  },

  settingRowVertical: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },

  settingInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
  },

  settingLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: '#1d1d1f',
  },

  settingDescription: {
    fontSize: 12,
    color: '#6e6e73',
    lineHeight: 1.4,
  },

  // Toggle
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
    position: 'relative',
    flexShrink: 0,
  },

  toggleKnob: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 20,
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
    transition: 'transform 0.2s ease',
  },

  // Select
  select: {
    minWidth: 180,
    padding: '8px 12px',
    backgroundColor: '#ffffff',
    border: '1px solid rgba(60, 60, 67, 0.3)',
    borderRadius: 8,
    color: '#1d1d1f',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'border-color 0.2s ease',
    maxWidth: '100%',
  },

  // Slider
  sliderContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 220,
    maxWidth: 320,
    width: '100%',
  },

  sliderValue: {
    fontSize: 13,
    fontWeight: 500,
    color: '#3B82F6',
    minWidth: 48,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },

  slider: {
    width: 120,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#374151',
    cursor: 'pointer',
  },

  // Directory Picker
  directoryPicker: {
    display: 'flex',
    gap: 8,
    minWidth: 0,
    width: '100%',
  },

  directoryInput: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#ffffff',
    border: '1px solid rgba(60, 60, 67, 0.3)',
    borderRadius: 8,
    color: '#1d1d1f',
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },

  browseButton: {
    padding: '8px 12px',
    backgroundColor: '#f2f2f7',
    border: '1px solid rgba(60, 60, 67, 0.28)',
    borderRadius: 8,
    color: '#1d1d1f',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  },

  // Key Recorder
  keyRecorder: {
    minWidth: 140,
    padding: '8px 12px',
    backgroundColor: '#ffffff',
    border: '1px solid rgba(60, 60, 67, 0.3)',
    borderRadius: 8,
    color: '#1d1d1f',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  keyRecorderRecording: {
    color: '#3B82F6',
    animation: 'pulse 1s ease-in-out infinite',
  },

  keyRecorderValue: {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    fontSize: 12,
  },

  conflictWarning: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#F59E0B',
    fontSize: 12,
    marginTop: 4,
  },

  // Color Picker
  colorPickerContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },

  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  customColorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },

  customColorInput: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '2px solid rgba(60, 60, 67, 0.3)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },

  customColorLabel: {
    fontSize: 10,
    color: '#6b7280',
  },

  // API Key
  apiKeyContainer: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },

  apiKeyInputWrapper: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },

  apiKeyInput: {
    width: '100%',
    padding: '10px 40px 10px 12px',
    backgroundColor: '#ffffff',
    border: '1px solid rgba(60, 60, 67, 0.3)',
    borderRadius: 8,
    color: '#1d1d1f',
    fontSize: 13,
    transition: 'border-color 0.2s ease',
  },

  apiKeyVisibilityButton: {
    position: 'absolute',
    right: 8,
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#6e6e73',
    cursor: 'pointer',
    transition: 'color 0.15s ease',
  },

  apiKeyTestButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 16px',
    backgroundColor: '#3B82F6',
    border: 'none',
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  },

  apiKeyError: {
    display: 'block',
    fontSize: 12,
    color: '#F87171',
    marginTop: 4,
  },

  apiKeySuccess: {
    display: 'block',
    fontSize: 12,
    color: '#34D399',
    marginTop: 4,
  },

  // Service Info
  serviceInfo: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(10, 132, 255, 0.08)',
    borderRadius: 8,
    border: '1px solid rgba(59, 130, 246, 0.2)',
    marginBottom: 12,
  },

  serviceName: {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    color: '#1d1d1f',
  },

  serviceDescription: {
    display: 'block',
    fontSize: 12,
    color: '#3a3a3c',
    marginTop: 2,
    lineHeight: 1.4,
  },

  // Buttons
  secondaryButton: {
    padding: '8px 16px',
    backgroundColor: '#f2f2f7',
    border: '1px solid rgba(60, 60, 67, 0.3)',
    borderRadius: 8,
    color: '#1d1d1f',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  dangerButton: {
    padding: '8px 16px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    color: '#F87171',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  // Theme Preview
  themePreview: {
    padding: 16,
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
    borderRadius: 8,
  },

  previewCard: {
    padding: 16,
    borderRadius: 12,
    border: '1px solid',
    transition: 'all 0.2s ease',
  },

  previewHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },

  previewDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    transition: 'background-color 0.2s ease',
  },

  previewTitle: {
    fontSize: 14,
    fontWeight: 500,
    transition: 'color 0.2s ease',
  },

  previewButton: {
    width: '100%',
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'default',
    transition: 'background-color 0.2s ease',
  },

  // Hotkey Reference
  hotkeyReference: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 4,
  },

  hotkeyRefItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  hotkeyRefLabel: {
    fontSize: 13,
    color: '#3a3a3c',
  },

  kbd: {
    display: 'inline-block',
    padding: '4px 10px',
    backgroundColor: '#f2f2f7',
    borderRadius: 6,
    border: '1px solid rgba(60, 60, 67, 0.26)',
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    color: '#1d1d1f',
    boxShadow: '0 1px 0 rgba(60, 60, 67, 0.22)',
  },

  // Footer
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderTop: '1px solid rgba(60, 60, 67, 0.2)',
    backgroundColor: 'rgba(246, 246, 248, 0.92)',
    flexWrap: 'wrap',
    gap: 10,
  },

  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },

  footerText: {
    fontSize: 12,
    color: '#6e6e73',
  },

  savedIndicator: {
    marginLeft: 8,
    color: '#10B981',
  },

  resetAllButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(60, 60, 67, 0.3)',
    borderRadius: 8,
    color: '#3a3a3c',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  // Spinner
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#ffffff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

export default SettingsPanel;
