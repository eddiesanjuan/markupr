/**
 * Settings Panel Styles
 *
 * Shared style definitions used across all settings primitives and tab components.
 */

import type React from 'react';

export type ExtendedCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

export const styles: Record<string, ExtendedCSSProperties> = {
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
    backgroundColor: 'var(--bg-overlay)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },

  panel: {
    position: 'relative',
    width: '100%',
    maxWidth: 940,
    maxHeight: '92vh',
    backgroundColor: 'var(--bg-elevated)',
    borderRadius: 16,
    boxShadow: '0 24px 56px rgba(0, 0, 0, 0.42), 0 0 0 1px var(--border-default)',
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
    borderBottom: '1px solid var(--border-default)',
    WebkitAppRegion: 'drag',
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: 0,
  },

  headerTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },

  byokBadge: {
    border: '1px solid rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    color: 'var(--status-warning)',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 999,
    padding: '4px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
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
    color: 'var(--text-tertiary)',
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
    borderRight: '1px solid var(--border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flexShrink: 0,
  },

  sidebarCompact: {
    width: '100%',
    borderRight: 'none',
    borderBottom: '1px solid var(--border-default)',
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
    color: 'var(--text-tertiary)',
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
    color: 'var(--text-secondary)',
    margin: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  sectionDescription: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    marginTop: 2,
  },

  sectionContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    backgroundColor: 'var(--bg-secondary)',
    borderRadius: 12,
    padding: 16,
    border: '1px solid var(--border-default)',
  },

  resetSectionButton: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-default)',
    borderRadius: 6,
    color: 'var(--text-tertiary)',
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
    color: 'var(--text-primary)',
  },

  settingDescription: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    lineHeight: 1.4,
  },

  // Toggle
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    border: '1px solid var(--border-strong)',
    padding: 0,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
  },

  toggleKnob: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 18,
    height: 18,
    borderRadius: '50%',
    backgroundColor: 'var(--text-inverse)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
    transition: 'transform 0.2s ease',
    willChange: 'transform',
  },

  // Select
  select: {
    minWidth: 180,
    padding: '8px 12px',
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: 'var(--text-primary)',
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
    color: 'var(--text-link)',
    minWidth: 48,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },

  slider: {
    width: 120,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'var(--border-strong)',
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
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },

  browseButton: {
    padding: '8px 12px',
    backgroundColor: 'var(--bg-subtle)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: 'var(--text-primary)',
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
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  keyRecorderRecording: {
    color: 'var(--text-link)',
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
    color: 'var(--status-warning)',
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
    border: '2px solid var(--border-default)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },

  customColorLabel: {
    fontSize: 10,
    color: 'var(--text-tertiary)',
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
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: 'var(--text-primary)',
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
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    transition: 'color 0.15s ease',
  },

  apiKeyTestButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 16px',
    backgroundColor: 'var(--accent-default)',
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
    color: 'var(--status-error)',
    marginTop: 4,
  },

  apiKeySuccess: {
    display: 'block',
    fontSize: 12,
    color: 'var(--status-success)',
    marginTop: 4,
  },

  // Service Info
  serviceInfo: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    backgroundColor: 'var(--accent-subtle)',
    borderRadius: 8,
    border: '1px solid var(--accent-muted)',
    marginBottom: 12,
  },

  serviceName: {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },

  serviceDescription: {
    display: 'block',
    fontSize: 12,
    color: 'var(--text-secondary)',
    marginTop: 2,
    lineHeight: 1.4,
  },

  // Buttons
  secondaryButton: {
    padding: '8px 16px',
    backgroundColor: 'var(--bg-subtle)',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: 'var(--text-primary)',
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
    color: 'var(--status-error)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },

  // Theme Preview
  themePreview: {
    padding: 16,
    backgroundColor: 'var(--bg-subtle)',
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
    color: 'var(--text-inverse)',
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
    color: 'var(--text-secondary)',
  },

  // Footer
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderTop: '1px solid var(--border-default)',
    backgroundColor: 'var(--bg-secondary)',
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
    color: 'var(--text-tertiary)',
  },

  savedIndicator: {
    marginLeft: 8,
    color: 'var(--status-success)',
  },

  resetAllButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-default)',
    borderRadius: 8,
    color: 'var(--text-secondary)',
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
    borderTopColor: 'var(--text-inverse)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};
