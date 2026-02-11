import React from 'react';
import { styles } from '../settings/settingsStyles';

export const DropdownSetting: React.FC<{
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
