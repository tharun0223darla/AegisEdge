/// <reference types="@capacitor/local-notifications" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.meditrack.ai',
  appName: 'MediTrack AI',
  webDir: 'dist',
  server: {
    // Gives the WebView an HTTPS origin. The API must allow https://localhost
    // in addition to the deployed web origin.
    androidScheme: 'https',
  },
};

export default config;
