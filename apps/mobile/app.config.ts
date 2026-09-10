import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: '投资记录', slug: 'portfolio-mobile', version: '0.0.0', scheme: 'portfolio-local',
  platforms: ['ios', 'android'], orientation: 'portrait', userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: 'local.portfolio.journal', supportsTablet: true },
  android: { package: 'local.portfolio.journal', allowBackup: false },
  plugins: [['expo-sqlite', { useSQLCipher: true, enableFTS: true }],
    ['expo-secure-store', { configureAndroidBackup: true }], './plugins/with-local-security.cjs'],
  experiments: { autolinkingModuleResolution: true },
};
export default config;
