/**
 * Settings Module
 *
 * Exports the SettingsManager for persistent settings storage
 * and secure API key management via keytar.
 */

export {
  SettingsManager,
  settingsManager,
  getSettingsManager,
  createSettingsManager,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
} from './SettingsManager';

export type { AppSettings, ISettingsManager } from './SettingsManager';

export { settingsManager as default } from './SettingsManager';
