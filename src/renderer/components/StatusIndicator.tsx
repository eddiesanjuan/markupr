/**
 * Status Indicator Component
 *
 * Shows the current recording/processing status with visual feedback
 */

import React from 'react';
import type { SessionStatus } from '../../shared/types';

interface StatusIndicatorProps {
  status: SessionStatus;
  error?: string | null;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, error }) => {
  const getColor = (): string => {
    switch (status) {
      case 'recording':
        return '#ff3b30';
      case 'processing':
        return '#ff9f0a';
      case 'complete':
        return '#34c759';
      case 'error':
        return '#ff3b30';
      default:
        return '#8e8e93';
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
    <div style={styles.container}>
      <div
        style={{
          ...styles.dot,
          backgroundColor: color,
          boxShadow: status === 'recording' ? `0 0 8px ${color}` : 'none',
          animation: status === 'recording' ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
      <span style={styles.text}>{getText()}</span>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
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
    color: '#1d1d1f',
    fontSize: 13,
    fontWeight: 500,
  },
};

export default StatusIndicator;
