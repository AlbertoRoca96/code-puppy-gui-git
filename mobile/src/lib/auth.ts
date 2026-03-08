import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = 'https://apalydgxzngsmzxgldlz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QLhy2Ilvvo8d2M3kQaEhYw_VhHVwJ8K';
const AUTH_STORAGE_KEY = 'code_puppy_supabase_session';
const EXPIRY_SKEW_SECONDS = 60;

let refreshPromise: Promise<SupabaseAuthSession | null> | null = null;

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

function normalizeSession(session: SupabaseAuthSession): SupabaseAuthSession {
  const expiresIn = (session as any).expires_in;
  const expiresAt = session.expires_at || (expiresIn ? Math.floor(Date.now() / 1000) + Number(expiresIn) : undefined);
  return {
    ...session,
    expires_at: expiresAt,
  };
}

function isSessionExpired(session: SupabaseAuthSession | null): boolean {
  if (!session?.access_token) return true;
  if (!session.expires_at) return false;
  return session.expires_at <= Math.floor(Date.now() / 1000) + EXPIRY_SKEW_SECONDS;
}

export async function signInWithPassword(email: string, password: string): Promise<SupabaseAuthSession> {
  const data = normalizeSession(
    (await authRequest('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })) as SupabaseAuthSession
  );
  await saveStoredSession(data);
  return data;
}

export async function signUpWithPassword(email: string, password: string): Promise<SupabaseAuthSession> {
  const data = normalizeSession(
    (await authRequest('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })) as SupabaseAuthSession
  );
  if (data.access_token) {
    await saveStoredSession(data);
  }
  return data;
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

export async function refreshStoredSession(force = false): Promise<SupabaseAuthSession | null> {
  const current = await loadStoredSession();
  if (!current?.refresh_token) {
    await saveStoredSession(null);
    return null;
  }
  if (!force && !isSessionExpired(current)) {
    return current;
  }
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const refreshed = normalizeSession(
          (await authRequest('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: current.refresh_token }),
          })) as SupabaseAuthSession
        );
        await saveStoredSession(refreshed);
        return refreshed;
      } catch {
        await saveStoredSession(null);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export async function getValidAccessToken(forceRefresh = false): Promise<string | null> {
  const session = await loadStoredSession();
  if (!session) {
    return null;
  }
  if (forceRefresh || isSessionExpired(session)) {
    const refreshed = await refreshStoredSession(true);
    return refreshed?.access_token || null;
  }
  return session.access_token || null;
}

export async function getAccessToken(): Promise<string | null> {
  return getValidAccessToken(false);
}
