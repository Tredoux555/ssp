import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.psp.app',
  appName: 'PSP',
  webDir: 'out',
  server: {
    // Allow localhost for development
    androidScheme: 'https',
    iosScheme: 'https',
    // For development, you can use:
    // url: 'http://localhost:3000',
    // cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#007A4D', // South African green
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#FFB612', // South African gold
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#007A4D', // South African green
    },
  },
};

export default config;
