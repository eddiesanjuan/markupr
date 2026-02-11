/**
 * AppWrapper.tsx
 *
 * Root wrapper that composes all context providers around the App component.
 * Provider order matters: RecordingProvider > ProcessingProvider > UIProvider.
 */

import React from 'react';
import App from './App';
import { ErrorBoundary } from './components';
import { ThemeProvider } from './components/ThemeProvider';
import { RecordingProvider, ProcessingProvider, UIProvider } from './contexts';

export const AppWrapper: React.FC = () => (
  <ErrorBoundary>
    <ThemeProvider>
      <RecordingProvider>
        <ProcessingProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </ProcessingProvider>
      </RecordingProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default AppWrapper;
