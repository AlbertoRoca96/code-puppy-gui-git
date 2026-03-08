import type { ConfigContext, ExpoConfig } from "@expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: "Code Puppy",
    slug: "code-puppy-mobile",
    owner: "AlbertoRoca96",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    newArchEnabled: false,
    scheme: "codepuppy",
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.albertoroca96.codepuppy",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.albertoroca96.codepuppy",
      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",
        backgroundColor: "#ffffff",
      },
      icon: "./assets/icon.png",
    },
    plugins: [
      "expo-router",
    ],
    extra: {
      eas: {
        projectId: "get-from-eas-init",
      },
      apiBase: "https://code-puppy-api.fly.dev",
    },
    web: {
      bundler: "metro",
      output: "static",
    },
    experiments: {
      typedRoutes: true,
    },
  };
};
