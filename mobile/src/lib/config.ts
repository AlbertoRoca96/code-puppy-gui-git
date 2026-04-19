import Constants from 'expo-constants';

import { loadPreferences } from './preferences';

const extra = (Constants.expoConfig?.extra || {}) as {
  apiBase?: string;
  webBasePath?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

export const DEFAULT_API_BASE = extra.apiBase || 'https://code-puppy-api.fly.dev';
export const API_BASE = DEFAULT_API_BASE;
export const WEB_BASE_PATH = extra.webBasePath || '/code-puppy-gui-git';
export const SUPABASE_URL =
  extra.supabaseUrl || 'https://apalydgxzngsmzxgldlz.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  extra.supabasePublishableKey || 'sb_publishable_QLhy2Ilvvo8d2M3kQaEhYw_VhHVwJ8K';

export async function getApiBase(): Promise<string> {
  const prefs = await loadPreferences();
  return (prefs.apiBaseOverride || '').trim() || DEFAULT_API_BASE;
}

export async function getApiBaseCandidates(): Promise<string[]> {
  const prefs = await loadPreferences();
  const override = (prefs.apiBaseOverride || '').trim();
  if (override && override !== DEFAULT_API_BASE) {
    return [override, DEFAULT_API_BASE];
  }
  return [DEFAULT_API_BASE];
}

export function getWebAuthCallbackUrl(): string | undefined {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return undefined;
  }
  const basePath = WEB_BASE_PATH.startsWith('/') ? WEB_BASE_PATH : `/${WEB_BASE_PATH}`;
  return `${window.location.origin}${basePath}/auth/callback`;
}
