/**
 * FeedbackFlow Donate Button
 *
 * A clean, minimal donate link with subtle native macOS styling.
 * Coffee icon + rotating messages with restrained emphasis.
 * Messages rotate on each app launch (not during a session).
 * Links to Ko-fi for support.
 */

import React, { useEffect, useRef, useMemo, useState } from 'react';
import {
  DONATE_URL,
  getCurrentDonateMessage,
  incrementDonateMessageIndex,
} from '../donateMessages';

// ============================================================================
// Constants
// ============================================================================

const TEXT_COLOR = '#3a3a3c';
const TEXT_HOVER = '#0077ed';
const BORDER_COLOR = 'rgba(60, 60, 67, 0.24)';
const BORDER_HOVER = 'rgba(0, 122, 255, 0.36)';
const BG_COLOR = 'rgba(120, 120, 128, 0.12)';
const BG_HOVER = 'rgba(0, 122, 255, 0.1)';

// ============================================================================
// Types
// ============================================================================

export interface DonateButtonProps {
  /** Additional CSS class name */
  className?: string;
  /** Override the default message (for testing) */
  message?: string;
  /** Custom style overrides */
  style?: React.CSSProperties;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DonateButton - Clean, minimal support link
 *
 * Displays a coffee emoji + rotating message in coral color.
 * Subtle styling - just a small link at bottom of popover.
 */
export const DonateButton: React.FC<DonateButtonProps> = ({
  className,
  message: messageProp,
  style: styleProp,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Track if we've already incremented this session
  const hasIncrementedRef = useRef(false);

  // Get the current message on mount
  const message = useMemo(() => {
    return messageProp || getCurrentDonateMessage();
  }, [messageProp]);

  // Increment the message index for next app launch (once per session)
  useEffect(() => {
    if (!hasIncrementedRef.current && !messageProp) {
      incrementDonateMessageIndex();
      hasIncrementedRef.current = true;
    }
  }, [messageProp]);

  const handleClick = () => {
    // Open Ko-fi in default browser
    window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...styles.button,
        color: isHovered ? TEXT_HOVER : TEXT_COLOR,
        borderColor: isHovered ? BORDER_HOVER : BORDER_COLOR,
        backgroundColor: isHovered ? BG_HOVER : BG_COLOR,
        ...styleProp,
      }}
      className={className}
      aria-label={message}
    >
      <span style={styles.emoji} aria-hidden="true">&#9749;</span>
      <span style={styles.text}>{message}</span>
    </button>
  );
};

// ============================================================================
// Styles
// ============================================================================

type ExtendedCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

const styles: Record<string, ExtendedCSSProperties> = {
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '6px 10px',
    backgroundColor: BG_COLOR,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 999,
    color: TEXT_COLOR,
    fontSize: 12,
    fontWeight: 550,
    cursor: 'pointer',
    transition: 'color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease',
    whiteSpace: 'nowrap',
    minHeight: 30,
    WebkitAppRegion: 'no-drag',
  },

  emoji: {
    fontSize: 12,
    lineHeight: 1,
  },

  text: {
    lineHeight: 1,
  },
};

export default DonateButton;
