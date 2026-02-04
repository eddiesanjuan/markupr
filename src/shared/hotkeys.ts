/**
 * Platform-aware hotkey definitions for FeedbackFlow
 *
 * Provides consistent hotkey handling across macOS, Windows, and Linux.
 * Uses Electron's accelerator format internally but converts to
 * platform-appropriate display formats.
 */

// ============================================================================
// Types
// ============================================================================

export interface HotkeyDefinition {
  id: string;
  label: string;
  description: string;
  macAccelerator: string;
  winLinuxAccelerator: string;
}

export interface DisplayKey {
  key: string;
  symbol: string;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect if running on macOS
 * Works in both main process (process.platform) and renderer (navigator.platform)
 */
export function isMacOS(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'darwin';
  }
  if (typeof navigator !== 'undefined' && navigator.platform) {
    return navigator.platform.toUpperCase().includes('MAC');
  }
  return false;
}

/**
 * Detect if running on Windows
 */
export function isWindows(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }
  if (typeof navigator !== 'undefined' && navigator.platform) {
    return navigator.platform.toUpperCase().includes('WIN');
  }
  return false;
}

// ============================================================================
// Hotkey Definitions
// ============================================================================

/**
 * All hotkey definitions for FeedbackFlow
 * Uses Electron accelerator format (CommandOrControl, Shift, Alt, etc.)
 */
export const HOTKEYS: HotkeyDefinition[] = [
  {
    id: 'toggleRecording',
    label: 'Toggle Recording',
    description: 'Start or stop recording',
    macAccelerator: 'Command+Shift+F',
    winLinuxAccelerator: 'Ctrl+Shift+F',
  },
  {
    id: 'manualScreenshot',
    label: 'Manual Screenshot',
    description: 'Capture screenshot immediately',
    macAccelerator: 'Command+Shift+S',
    winLinuxAccelerator: 'Ctrl+Shift+S',
  },
  {
    id: 'pauseResume',
    label: 'Pause/Resume',
    description: 'Pause or resume recording',
    macAccelerator: 'Command+Shift+P',
    winLinuxAccelerator: 'Ctrl+Shift+P',
  },
  {
    id: 'openSettings',
    label: 'Open Settings',
    description: 'Open settings panel',
    macAccelerator: 'Command+,',
    winLinuxAccelerator: 'Ctrl+,',
  },
  {
    id: 'showHelp',
    label: 'Show Help',
    description: 'Show keyboard shortcuts',
    macAccelerator: 'Command+?',
    winLinuxAccelerator: 'Ctrl+Shift+/',
  },
  {
    id: 'quit',
    label: 'Quit',
    description: 'Quit FeedbackFlow',
    macAccelerator: 'Command+Q',
    winLinuxAccelerator: 'Alt+F4',
  },
];

// ============================================================================
// Key Symbol Mappings
// ============================================================================

/**
 * macOS key symbols (SF Symbols style)
 */
const MAC_SYMBOLS: Record<string, string> = {
  command: '\u2318',     // Command key
  cmd: '\u2318',
  control: '\u2303',     // Control key
  ctrl: '\u2303',
  option: '\u2325',      // Option/Alt key
  alt: '\u2325',
  shift: '\u21E7',       // Shift key
  enter: '\u21A9',       // Return/Enter key
  return: '\u21A9',
  delete: '\u232B',      // Delete/Backspace key
  backspace: '\u232B',
  escape: '\u238B',      // Escape key
  esc: '\u238B',
  tab: '\u21E5',         // Tab key
  space: '\u2423',       // Space key
  up: '\u2191',          // Up arrow
  down: '\u2193',        // Down arrow
  left: '\u2190',        // Left arrow
  right: '\u2192',       // Right arrow
  pageup: '\u21DE',      // Page Up
  pagedown: '\u21DF',    // Page Down
  home: '\u2196',        // Home
  end: '\u2198',         // End
  fn: 'fn',              // Function key
};

/**
 * Windows/Linux key display names
 */
const WIN_LINUX_NAMES: Record<string, string> = {
  command: 'Ctrl',
  cmd: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  return: 'Enter',
  delete: 'Del',
  backspace: 'Backspace',
  escape: 'Esc',
  esc: 'Esc',
  tab: 'Tab',
  space: 'Space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  home: 'Home',
  end: 'End',
  fn: 'Fn',
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a hotkey definition by ID
 */
export function getHotkeyById(id: string): HotkeyDefinition | undefined {
  return HOTKEYS.find(h => h.id === id);
}

/**
 * Get the Electron accelerator string for a hotkey
 * Returns platform-appropriate accelerator
 */
export function getAccelerator(hotkeyId: string): string {
  const hotkey = getHotkeyById(hotkeyId);
  if (!hotkey) return '';

  return isMacOS() ? hotkey.macAccelerator : hotkey.winLinuxAccelerator;
}

/**
 * Get the Electron accelerator from a custom hotkey string
 * Handles both platform-specific and generic formats
 */
export function normalizeAccelerator(accelerator: string): string {
  // Replace CommandOrControl with platform-specific
  if (isMacOS()) {
    return accelerator
      .replace(/CommandOrControl/gi, 'Command')
      .replace(/CmdOrCtrl/gi, 'Cmd');
  } else {
    return accelerator
      .replace(/CommandOrControl/gi, 'Control')
      .replace(/CmdOrCtrl/gi, 'Ctrl')
      .replace(/Command/gi, 'Control')
      .replace(/Cmd/gi, 'Ctrl');
  }
}

/**
 * Parse an accelerator string into individual keys
 */
export function parseAccelerator(accelerator: string): string[] {
  return accelerator.split('+').map(k => k.trim());
}

/**
 * Get display keys for an accelerator (for UI rendering)
 * Returns keys formatted appropriately for the current platform
 */
export function getDisplayKeys(accelerator: string): string[] {
  const keys = parseAccelerator(accelerator);
  const platform = isMacOS();

  return keys.map(key => {
    const lowerKey = key.toLowerCase();

    if (platform) {
      // macOS: Use symbols
      return MAC_SYMBOLS[lowerKey] || key.toUpperCase();
    } else {
      // Windows/Linux: Use readable names
      return WIN_LINUX_NAMES[lowerKey] || key.toUpperCase();
    }
  });
}

/**
 * Get display keys for a hotkey by ID
 */
export function getDisplayKeysById(hotkeyId: string): string[] {
  const accelerator = getAccelerator(hotkeyId);
  return getDisplayKeys(accelerator);
}

/**
 * Format an accelerator for display
 * Returns a single string like "Cmd+Shift+F" or "Ctrl+Shift+F"
 */
export function formatAcceleratorForDisplay(accelerator: string): string {
  const keys = getDisplayKeys(accelerator);

  if (isMacOS()) {
    // macOS: No separator between symbols
    return keys.join('');
  } else {
    // Windows/Linux: Plus sign separator
    return keys.join('+');
  }
}

/**
 * Format a hotkey for display by ID
 */
export function formatHotkeyForDisplay(hotkeyId: string): string {
  const accelerator = getAccelerator(hotkeyId);
  return formatAcceleratorForDisplay(accelerator);
}

/**
 * Convert a HotkeyConfig-style accelerator to display format
 * Handles "CommandOrControl" and other generic formats
 */
export function formatHotkeyConfigForDisplay(accelerator: string): string {
  const normalized = normalizeAccelerator(accelerator);
  return formatAcceleratorForDisplay(normalized);
}

// ============================================================================
// Exports for types compatibility
// ============================================================================

export type HotkeyId = (typeof HOTKEYS)[number]['id'];
