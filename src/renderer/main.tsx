/**
 * FeedbackFlow - Renderer Entry Point
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './components/ThemeProvider';

// Import global styles (includes CSS reset and theme utilities)
import './styles/globals.css';
// Import premium animation styles
import './styles/animations.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  console.error('[Global Error Handler]', event.error);
  // Could report to main process here
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
  // Could report to main process here
});

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ThemeProvider defaultMode="dark" defaultAccentColor="blue">
      <ErrorBoundary
        onError={(error, errorInfo) => {
          console.error('[App ErrorBoundary]', error, errorInfo);
        }}
      >
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
