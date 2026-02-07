/**
 * AppWrapper.tsx
 *
 * Keep startup simple and always land on the main app.
 * Model downloads/transcription setup are optional and handled in-app.
 */

import React from 'react';
import App from './App';

export const AppWrapper: React.FC = () => <App />;

export default AppWrapper;
