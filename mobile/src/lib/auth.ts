import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = 'https://apalydgxzngsmzxgldlz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QLhy2Ilvvo8d2M3kQaEhYw_VhHVwJ8K';
const AUTH_STORAGE_KEY = 'code_puppy_supabase_session';

export interface SupabaseAuthSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  token_type?: string;
  user?: {
    id: string;
    email?: string;
  } | null;
}

async function authRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    try {
      const data = JSON.parse(text);
      throw new Error(data.msg || data.error_description || data.error || 'Auth failed');
    } catch {
      throw new Error(text || `Auth failed (${response.status})`);
    }
  }

  return text ? JSON.parse(text) : {};
}

export async function loadStoredSession(): Promise<SupabaseAuthSession | null> {
  const raw = await SecureStore.getItemAsync(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SupabaseAuthSession;
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: SupabaseAuthSession | null): Promise<void> {
  if (!session) {
    await SecureStore.deleteItemAsync(AUTH_STORAGE_KEY);
    return;
  }
  await SecureStore.setItemAsync(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export async function signInWithPassword(email: string, password: string): Promise<SupabaseAuthSession> {
  const data = await authRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await saveStoredSession(data as SupabaseAuthSession);
  return data as SupabaseAuthSession;
}

export async function signUpWithPassword(email: string, password: string): Promise<SupabaseAuthSession> {
  const data = await authRequest('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if ((data as SupabaseAuthSession).access_token) {
    await saveStoredSession(data as SupabaseAuthSession);
  }
  return data as SupabaseAuthSession;
}

export async function signOut(): Promise<void> {
  const session = await loadStoredSession();
  if (session?.access_token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    }).catch(() => undefined);
  }
  await saveStoredSession(null);
}

export async function getAccessToken(): Promise<string | null> {
  const session = await loadStoredSession();
  return session?.access_token || null;
}
