import { Platform, useWindowDimensions } from 'react-native';

export function useDeviceUi() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isNativeApp = Platform.OS === 'ios' || Platform.OS === 'android';
  const isWide = width >= 1024;
  const isTabletish = width >= 768;

  return {
    width,
    isWeb,
    isNativeApp,
    isWide,
    isTabletish,
    prefersAppLikeLayout: isNativeApp || !isWide,
  };
}
