import React, { useRef, useEffect, useState } from 'react';
import { useTheme } from '../hooks/useTheme';

interface ProcessingOverlayProps {
  percent: number;
  step: string;
  onHide?: () => void;
}

export const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({
  percent,
  step,
  onHide,
}) => {
  const { colors } = useTheme();
  const boundedPercent = Math.max(0, Math.min(100, Math.round(percent)));

  // Announce progress at 25% milestones for screen readers
  const lastAnnouncedRef = useRef(0);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const milestone = Math.floor(boundedPercent / 25) * 25;
    if (milestone > lastAnnouncedRef.current && milestone > 0) {
      lastAnnouncedRef.current = milestone;
      setAnnouncement(`Processing ${milestone}% complete. ${step}`);
    }
  }, [boundedPercent, step]);

  return (
    <div
      role="status"
      aria-label={`Processing ${boundedPercent}% complete`}
      style={{
        position: 'fixed',
        left: '50%',
        top: 8,
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 'min(304px, calc(100vw - 16px))',
        display: 'grid',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 12,
        border: '1px solid rgba(160, 176, 206, 0.2)',
        background:
          'linear-gradient(150deg, rgba(14, 22, 36, 0.82), rgba(10, 17, 29, 0.74))',
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
        backdropFilter: 'blur(16px) saturate(1.12)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.12)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties & { WebkitAppRegion?: string }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'rgba(178, 194, 218, 0.88)',
            fontWeight: 700,
          }}
        >
          Processing
        </span>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            style={{
              border: '1px solid rgba(159, 173, 196, 0.28)',
              background: 'rgba(153, 168, 190, 0.16)',
              color: 'rgba(224, 233, 249, 0.95)',
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Hide
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 5 }}>
        <div
          style={{
            height: 6,
            borderRadius: 999,
            overflow: 'hidden',
            background: 'rgba(81, 104, 136, 0.34)',
          }}
        >
          <div
            style={{
              width: `${boundedPercent}%`,
              height: '100%',
              borderRadius: 999,
              background: 'linear-gradient(90deg, var(--accent-default) 0%, var(--text-link) 100%)',
              transition: 'width 460ms cubic-bezier(0.23, 1, 0.32, 1)',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 11,
              color: colors.text.link,
              fontWeight: 700,
              minWidth: 40,
            }}
          >
            {boundedPercent}%
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'rgba(204, 216, 237, 0.92)',
              textAlign: 'right',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={step}
          >
            {step}
          </span>
        </div>
      </div>

      {/* Screen reader progress announcements at 25% milestones */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {announcement}
      </div>
    </div>
  );
};

export default ProcessingOverlay;
