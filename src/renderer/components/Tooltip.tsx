/**
 * Premium Tooltip Component
 *
 * Animated tooltip with multiple placement options and arrow indicators.
 * Uses CSS animations for smooth enter/exit transitions.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** Tooltip content */
  content: React.ReactNode;
  /** Trigger element */
  children: React.ReactElement;
  /** Placement relative to trigger */
  placement?: TooltipPlacement;
  /** Delay before showing (ms) */
  showDelay?: number;
  /** Delay before hiding (ms) */
  hideDelay?: number;
  /** Offset from trigger (px) */
  offset?: number;
  /** Disable the tooltip */
  disabled?: boolean;
  /** Show arrow indicator */
  showArrow?: boolean;
  /** Maximum width */
  maxWidth?: number;
  /** Custom z-index */
  zIndex?: number;
}

// ============================================================================
// Tooltip Component
// ============================================================================

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = 'top',
  showDelay = 200,
  hideDelay = 0,
  offset = 8,
  disabled = false,
  showArrow = true,
  maxWidth = 240,
  zIndex = 1000,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimeoutRef = useRef<NodeJS.Timeout>();
  const hideTimeoutRef = useRef<NodeJS.Timeout>();

  // Calculate tooltip position
  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'top':
        top = triggerRect.top - tooltipRect.height - offset;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + offset;
        left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left - tooltipRect.width - offset;
        break;
      case 'right':
        top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + offset;
        break;
    }

    // Keep tooltip within viewport
    const padding = 8;
    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding));

    setPosition({ top, left });
  }, [placement, offset]);

  // Show tooltip
  const handleShow = useCallback(() => {
    if (disabled) return;

    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }

    showTimeoutRef.current = setTimeout(() => {
      setIsAnimatingOut(false);
      setIsVisible(true);
    }, showDelay);
  }, [disabled, showDelay]);

  // Hide tooltip
  const handleHide = useCallback(() => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
    }

    hideTimeoutRef.current = setTimeout(() => {
      setIsAnimatingOut(true);
      setTimeout(() => {
        setIsVisible(false);
        setIsAnimatingOut(false);
      }, 100); // Match exit animation duration
    }, hideDelay);
  }, [hideDelay]);

  // Update position when visible
  useEffect(() => {
    if (isVisible) {
      updatePosition();
      // Update on scroll/resize
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isVisible, updatePosition]);

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  // Get arrow styles based on placement
  const getArrowStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      width: 8,
      height: 8,
      backgroundColor: 'rgba(17, 24, 39, 0.95)',
      transform: 'rotate(45deg)',
    };

    switch (placement) {
      case 'top':
        return { ...base, bottom: -4, left: '50%', marginLeft: -4 };
      case 'bottom':
        return { ...base, top: -4, left: '50%', marginLeft: -4 };
      case 'left':
        return { ...base, right: -4, top: '50%', marginTop: -4 };
      case 'right':
        return { ...base, left: -4, top: '50%', marginTop: -4 };
    }
  };

  // Clone child with event handlers
  const trigger = React.cloneElement(children, {
    ref: triggerRef,
    onMouseEnter: (e: React.MouseEvent) => {
      handleShow();
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      handleHide();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      handleShow();
      children.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      handleHide();
      children.props.onBlur?.(e);
    },
  });

  return (
    <>
      {trigger}
      {isVisible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            ...styles.tooltip,
            top: position.top,
            left: position.left,
            maxWidth,
            zIndex,
          }}
          className={isAnimatingOut ? 'ff-tooltip-exit' : `ff-tooltip-enter${placement === 'bottom' ? '' : '-top'}`}
        >
          {content}
          {showArrow && <div style={getArrowStyles()} />}
        </div>
      )}
    </>
  );
};

// ============================================================================
// Hotkey Tooltip (for keyboard shortcuts)
// ============================================================================

export interface HotkeyTooltipProps extends Omit<TooltipProps, 'content'> {
  /** Action description */
  action: string;
  /** Keyboard shortcut keys */
  keys: string[];
}

export const HotkeyTooltip: React.FC<HotkeyTooltipProps> = ({
  action,
  keys,
  children,
  ...props
}) => {
  const content = (
    <div style={styles.hotkeyContent}>
      <span style={styles.hotkeyAction}>{action}</span>
      <div style={styles.hotkeyKeys}>
        {keys.map((key, index) => (
          <React.Fragment key={key}>
            <kbd style={styles.kbd}>{key}</kbd>
            {index < keys.length - 1 && <span style={styles.keySeparator}>+</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  return (
    <Tooltip content={content} {...props}>
      {children}
    </Tooltip>
  );
};

// ============================================================================
// Status Tooltip (colored based on status)
// ============================================================================

export type TooltipStatus = 'info' | 'success' | 'warning' | 'error';

export interface StatusTooltipProps extends Omit<TooltipProps, 'content'> {
  /** Tooltip message */
  message: string;
  /** Status type for color */
  status?: TooltipStatus;
}

const STATUS_COLORS: Record<TooltipStatus, string> = {
  info: 'var(--status-info)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  error: 'var(--status-error)',
};

export const StatusTooltip: React.FC<StatusTooltipProps> = ({
  message,
  status = 'info',
  children,
  ...props
}) => {
  const content = (
    <div style={styles.statusContent}>
      <div
        style={{
          ...styles.statusDot,
          backgroundColor: STATUS_COLORS[status],
        }}
      />
      <span>{message}</span>
    </div>
  );

  return (
    <Tooltip content={content} {...props}>
      {children}
    </Tooltip>
  );
};

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  tooltip: {
    position: 'fixed',
    padding: '8px 12px',
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 8,
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  hotkeyContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  hotkeyAction: {
    color: 'var(--text-secondary)',
  },
  hotkeyKeys: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  kbd: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    padding: '2px 6px',
    backgroundColor: 'rgba(55, 65, 81, 0.8)',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    fontWeight: 600,
    color: 'var(--text-primary)',
    border: '1px solid rgba(75, 85, 99, 0.5)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
  },
  keySeparator: {
    color: 'var(--text-tertiary)',
    fontSize: 10,
  },
  statusContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
};

// ============================================================================
// Exports
// ============================================================================

export default Tooltip;
