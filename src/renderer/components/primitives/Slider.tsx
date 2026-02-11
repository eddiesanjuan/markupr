import React from 'react';
import { styles } from '../settings/settingsStyles';

export const SliderSetting: React.FC<{
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
