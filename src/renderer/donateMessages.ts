/**
 * FeedbackFlow Donate Button Messages
 *
 * Rotating messages for the donate/support button.
 * Messages rotate on each app launch, not during a session.
 */

/**
 * Array of rotating donate button messages
 */
export const DONATE_MESSAGES = [
  'Buy Eddie a Coffee',
  'Buy Eddie Legos',
  'Buy Eddie Golf Balls',
  'Buy Eddie Tacos',
  'Buy Eddie a Plant',
  'Buy Eddie Socks',
  "Fund Eddie's Caffeine Addiction",
  'Support Open Source Chaos',
  'Keep Eddie Coding',
  'Taco Tuesday Sponsor',
] as const;

export type DonateMessage = (typeof DONATE_MESSAGES)[number];

/**
 * Ko-fi donation link
 */
export const DONATE_URL = 'https://ko-fi.com/eddiesanjuan';

/**
 * Storage key for persisting the message index
 */
export const DONATE_MESSAGE_INDEX_KEY = 'feedbackflow:donate-message-index';

/**
 * Get the current donate message index from localStorage
 * If not found, returns 0
 */
export function getDonateMessageIndex(): number {
  if (typeof localStorage === 'undefined') {
    return 0;
  }
  const stored = localStorage.getItem(DONATE_MESSAGE_INDEX_KEY);
  if (stored === null) {
    return 0;
  }
  const index = parseInt(stored, 10);
  if (isNaN(index) || index < 0 || index >= DONATE_MESSAGES.length) {
    return 0;
  }
  return index;
}

/**
 * Increment and persist the donate message index for next app launch
 * Called once per app session to rotate messages
 */
export function incrementDonateMessageIndex(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const currentIndex = getDonateMessageIndex();
  const nextIndex = (currentIndex + 1) % DONATE_MESSAGES.length;
  localStorage.setItem(DONATE_MESSAGE_INDEX_KEY, nextIndex.toString());
}

/**
 * Get the current donate message based on stored index
 */
export function getCurrentDonateMessage(): string {
  const index = getDonateMessageIndex();
  return DONATE_MESSAGES[index];
}
