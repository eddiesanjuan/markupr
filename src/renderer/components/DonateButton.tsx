/**
 * FeedbackFlow Donate Button
 *
 * A subtle, non-intrusive donate button with rotating messages.
 * Messages rotate on each app launch (not during a session).
 * Links to Ko-fi for support.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  DONATE_URL,
  getCurrentDonateMessage,
  incrementDonateMessageIndex,
} from '../donateMessages';

// ============================================================================
// Types
// ============================================================================

export interface DonateButtonProps {
  /** Additional CSS class name */
  className?: string;
  /** Override the default message (for testing) */
  message?: string;
  /** Compact mode - just heart icon with tooltip */
  compact?: boolean;
  /** Custom style overrides */
  style?: React.CSSProperties;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DonateButton - Rotating message support button
 *
 * Displays a rotating message on each app launch, linking to Ko-fi.
 * Subtle styling to be visible but not pushy.
 */
export const DonateButton: React.FC<DonateButtonProps> = ({
  className,
  message: messageProp,
  compact = false,
  style: styleProp,
}) => {
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

  if (compact) {
    return (
      <button
        onClick={handleClick}
        style={{ ...styles.compactButton, ...styleProp }}
        className={className}
        title={message}
        aria-label={message}
      >
        <HeartIcon />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      style={{ ...styles.button, ...styleProp }}
      className={className}
      aria-label={message}
    >
      <HeartIcon />
      <span style={styles.text}>{message}</span>
    </button>
  );
};

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Heart icon for the donate button
 */
const HeartIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    style={styles.icon}
    aria-hidden="true"
  >
    <path
      d="M7 12.25C7 12.25 1.75 9.1 1.75 5.425C1.75 4.38125 2.14375 3.38125 2.84375 2.625C3.54375 1.86875 4.49375 1.40625 5.5 1.34375C6.50625 1.28125 7.5 1.625 8.28125 2.29375C8.68125 1.9625 9.15 1.71875 9.65625 1.575C10.1625 1.43125 10.6938 1.39375 11.2188 1.46875C11.7438 1.54375 12.2438 1.725 12.6875 2C13.1312 2.275 13.5062 2.6375 13.7938 3.0625C14.0812 3.4875 14.275 3.96875 14.3625 4.475C14.45 4.98125 14.4312 5.5 14.3062 6C14.1812 6.5 13.9562 6.96875 13.6375 7.375C13.3187 7.78125 12.9125 8.11875 12.4375 8.3625"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7 12.25L12.25 7C12.7 6.55 13 5.975 13.1 5.35C13.2 4.725 13.1 4.0875 12.8125 3.525C12.525 2.9625 12.0625 2.5 11.5 2.2125C10.9375 1.925 10.3 1.825 9.675 1.925C9.05 2.025 8.475 2.325 8.025 2.775L7 3.8L5.975 2.775C5.525 2.325 4.95 2.025 4.325 1.925C3.7 1.825 3.0625 1.925 2.5 2.2125C1.9375 2.5 1.475 2.9625 1.1875 3.525C0.9 4.0875 0.8 4.725 0.9 5.35C1 5.975 1.3 6.55 1.75 7L7 12.25Z"
      fill="currentColor"
      fillOpacity="0.15"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
    gap: 6,
    padding: '6px 10px',
    backgroundColor: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
    WebkitAppRegion: 'no-drag',
  },

  compactButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    backgroundColor: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    color: '#9ca3af',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    WebkitAppRegion: 'no-drag',
  },

  icon: {
    flexShrink: 0,
  },

  text: {
    lineHeight: 1,
  },
};

// ============================================================================
// CSS-in-JS Hover Effect (applied via global CSS or inline event handlers)
// ============================================================================

// Note: For hover effects, add this to your global CSS or use onMouseEnter/onMouseLeave:
// .donate-button:hover {
//   background-color: rgba(255, 255, 255, 0.05);
//   border-color: rgba(236, 72, 153, 0.3);
//   color: #ec4899;
// }

export default DonateButton;
