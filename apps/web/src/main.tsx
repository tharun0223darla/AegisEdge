import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import { registerSW } from './pwa/registerSW';
import { registerLocalReminderTapHandler } from '@/lib/local-reminders';
import './index.css';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root element #root not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerLocalReminderTapHandler().catch((error) => console.warn('Local reminder tap handler registration failed', error));

if (import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  registerSW();
}
