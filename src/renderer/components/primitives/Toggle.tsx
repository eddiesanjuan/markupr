import React from 'react';
import { styles } from '../settings/settingsStyles';

export const ToggleSetting: React.FC<{
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
        backgroundColor: value ? 'var(--accent-default)' : 'var(--bg-tertiary)',
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
