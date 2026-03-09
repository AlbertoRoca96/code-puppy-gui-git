import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as {
  apiBase?: string;
  webBasePath?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

export const API_BASE = extra.apiBase || 'https://code-puppy-api.fly.dev';
export const WEB_BASE_PATH = extra.webBasePath || '/code-puppy-gui-git';
export const SUPABASE_URL =
  extra.supabaseUrl || 'https://apalydgxzngsmzxgldlz.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  extra.supabasePublishableKey || 'sb_publishable_QLhy2Ilvvo8d2M3kQaEhYw_VhHVwJ8K';

export function getWebAuthCallbackUrl(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return undefined;
  }
  const basePath = WEB_BASE_PATH.startsWith('/') ? WEB_BASE_PATH : `/${WEB_BASE_PATH}`;
  return `${window.location.origin}${basePath}/auth/callback`;
}
