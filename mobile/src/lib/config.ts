import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || {}) as {
  apiBase?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

export const API_BASE = extra.apiBase || 'https://code-puppy-api.fly.dev';
export const SUPABASE_URL =
  extra.supabaseUrl || 'https://apalydgxzngsmzxgldlz.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  extra.supabasePublishableKey || 'sb_publishable_QLhy2Ilvvo8d2M3kQaEhYw_VhHVwJ8K';
