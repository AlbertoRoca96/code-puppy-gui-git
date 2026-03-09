import type { ConfigContext, ExpoConfig } from "@expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: "Puppy Chat",
    slug: "code-puppy-mobile",
    owner: "al96",
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
        projectId: "e02a6075-5fc5-4238-8fe0-6b9c19ade4f0",
      },
      apiBase: process.env.EXPO_PUBLIC_API_BASE || "https://code-puppy-api.fly.dev",
      webBasePath: process.env.EXPO_PUBLIC_WEB_BASE_PATH || "/code-puppy-gui-git",
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || "https://apalydgxzngsmzxgldlz.supabase.co",
      supabasePublishableKey:
        process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        "sb_publishable_QLhy2Ilvvo8d2M3kQaEhYw_VhHVwJ8K",
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
