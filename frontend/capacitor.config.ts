import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ornav.clinical',
  appName: 'OR-Nav',
  webDir: 'public',
  server: {
    url: 'http://192.168.1.217:3000',
    cleartext: true,
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
