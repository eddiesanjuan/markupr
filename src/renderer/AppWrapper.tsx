/**
 * AppWrapper.tsx
 *
 * Root wrapper that composes all context providers around the App component.
 * Provider order matters: RecordingProvider > ProcessingProvider > UIProvider.
 */

import React from 'react';
import App from './App';
import { ErrorBoundary } from './components';
import { RecordingProvider, ProcessingProvider, UIProvider } from './contexts';

export const AppWrapper: React.FC = () => (
  <ErrorBoundary>
    <RecordingProvider>
      <ProcessingProvider>
        <UIProvider>
          <App />
        </UIProvider>
      </ProcessingProvider>
    </RecordingProvider>
  </ErrorBoundary>
);

export default AppWrapper;
