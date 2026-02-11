import React from 'react';

export type SettingsTab = 'general' | 'recording' | 'appearance' | 'hotkeys' | 'advanced';

export const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 12a2 2 0 100-4 2 2 0 000 4z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M16.472 12.111a1.5 1.5 0 00.3 1.655l.054.055a1.818 1.818 0 11-2.572 2.572l-.055-.055a1.5 1.5 0 00-1.655-.3 1.5 1.5 0 00-.909 1.373v.153a1.818 1.818 0 11-3.636 0v-.082a1.5 1.5 0 00-.982-1.371 1.5 1.5 0 00-1.655.3l-.055.054a1.818 1.818 0 11-2.572-2.572l.055-.055a1.5 1.5 0 00.3-1.655 1.5 1.5 0 00-1.373-.909h-.153a1.818 1.818 0 110-3.636h.082a1.5 1.5 0 001.371-.982 1.5 1.5 0 00-.3-1.655l-.054-.055a1.818 1.818 0 112.572-2.572l.055.055a1.5 1.5 0 001.655.3h.073a1.5 1.5 0 00.909-1.373v-.153a1.818 1.818 0 013.636 0v.082a1.5 1.5 0 00.909 1.371 1.5 1.5 0 001.655-.3l.055-.054a1.818 1.818 0 112.572 2.572l-.055.055a1.5 1.5 0 00-.3 1.655v.073a1.5 1.5 0 001.373.909h.153a1.818 1.818 0 010 3.636h-.082a1.5 1.5 0 00-1.371.909z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'recording',
    label: 'Recording',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M3 10a7 7 0 1014 0 7 7 0 00-14 0z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M10 3v14M3 10h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'hotkeys',
    label: 'Hotkeys',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect
          x="2"
          y="5"
          width="16"
          height="10"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M5 8h2M8 8h2M11 8h2M14 8h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 11h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M4 5h12M4 10h12M4 15h12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="8" cy="5" r="1.5" fill="currentColor" />
        <circle cx="14" cy="10" r="1.5" fill="currentColor" />
        <circle cx="6" cy="15" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];
