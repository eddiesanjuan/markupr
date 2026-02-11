import React from 'react';
import type { AppSettings } from '../../../shared/types';
import { SettingsSection, ToggleSetting, DirectoryPicker } from '../primitives';
import { styles } from './settingsStyles';

export const GeneralTab: React.FC<{
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
