/**
 * Status Indicator Component
 *
 * Shows the current recording/processing status with visual feedback
 */

import React from 'react';
import type { SessionStatus } from '../../shared/types';
import { useTheme } from '../hooks/useTheme';

interface StatusIndicatorProps {
  status: SessionStatus;
  error?: string | null;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, error }) => {
  const { colors } = useTheme();

  const getColor = (): string => {
    switch (status) {
      case 'recording':
        return colors.status.error;
      case 'processing':
        return colors.status.warning;
      case 'complete':
        return colors.status.success;
      case 'error':
        return colors.status.error;
      default:
        return colors.text.tertiary;
    }
  };

  const getText = (): string => {
    switch (status) {
      case 'recording':
        return 'Recording...';
      case 'processing':
        return 'Processing...';
      case 'complete':
        return 'Copied to clipboard!';
      case 'error':
        return error || 'Error occurred';
      default:
        return 'Ready';
    }
  };

  const color = getColor();

  return (
    <div style={styles.container} role="status" aria-live={status === 'error' ? 'assertive' : 'polite'}>
      <div
        style={{
          ...styles.dot,
          backgroundColor: color,
          boxShadow: status === 'recording' ? `0 0 8px ${color}` : 'none',
          animation: status === 'recording' ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
      <span style={styles.text}>{getText()}</span>
      {/* pulse keyframe provided by animations.css */}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    transition: 'all 0.2s ease',
  },
  text: {
    color: 'var(--text-primary)',
    fontSize: 13,
    fontWeight: 500,
  },
};

export default StatusIndicator;
