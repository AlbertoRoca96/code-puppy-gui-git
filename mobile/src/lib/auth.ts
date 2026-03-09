import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getWebAuthCallbackUrl, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
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

export interface AuthActionResult {
  session: SupabaseAuthSession | null;
  requiresEmailConfirmation?: boolean;
  message?: string;
}

function getEmailRedirectTo(): string | undefined {
  if (Platform.OS === 'web') {
    return getWebAuthCallbackUrl();
  }
  return 'codepuppy://auth/callback';
}

async function getStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function setStoredValue(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore browser storage failures
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredValue(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore browser storage failures
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
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
  const raw = await getStoredValue(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SupabaseAuthSession;
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: SupabaseAuthSession | null): Promise<void> {
  if (!session) {
    await deleteStoredValue(AUTH_STORAGE_KEY);
    return;
  }
  await setStoredValue(AUTH_STORAGE_KEY, JSON.stringify(session));
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

export function toFriendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('email_not_confirmed')) {
    return 'Your email is not confirmed yet. Check your inbox, tap the confirmation link, then sign in.';
  }
  if (message.toLowerCase().includes('invalid login credentials')) {
    return 'That email/password combo did not work. Double-check it and try again.';
  }
  if (message.toLowerCase().includes('password should be')) {
    return 'That password is too weak for Supabase. Try something longer and less tragic.';
  }
  return message;
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

export async function signUpWithPassword(email: string, password: string): Promise<AuthActionResult> {
  const data = normalizeSession(
    (await authRequest('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        options: { emailRedirectTo: getEmailRedirectTo() },
      }),
    })) as SupabaseAuthSession
  );
  if (data.access_token) {
    await saveStoredSession(data);
    return { session: data, requiresEmailConfirmation: false };
  }
  return {
    session: null,
    requiresEmailConfirmation: true,
    message: 'Signup succeeded. Check your email and confirm your account before signing in.',
  };
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

export async function sendPasswordResetEmail(email: string): Promise<void> {
  await authRequest('/auth/v1/recover', {
    method: 'POST',
    body: JSON.stringify({
      email,
      redirectTo: getEmailRedirectTo(),
    }),
  });
}

export async function completeAuthFromUrl(url: string): Promise<{ success: boolean; message: string }> {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    if (code) {
      const response = await authRequest(`/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        body: JSON.stringify({ auth_code: code }),
      });
      const session = normalizeSession(response as SupabaseAuthSession);
      if (session.access_token) {
        await saveStoredSession(session);
        return { success: true, message: 'Auth completed successfully.' };
      }
    }

    const hash = parsed.hash?.startsWith('#') ? parsed.hash.slice(1) : '';
    const hashParams = new URLSearchParams(hash);
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');
    if (access_token && refresh_token) {
      await saveStoredSession(
        normalizeSession({ access_token, refresh_token, token_type: 'bearer' } as SupabaseAuthSession)
      );
      return { success: true, message: 'Auth completed successfully.' };
    }

    return { success: false, message: 'No auth parameters found in callback URL.' };
  } catch (error) {
    return {
      success: false,
      message: toFriendlyAuthError(error),
    };
  }
}

export async function getCurrentSessionUser(): Promise<{
  id: string;
  email?: string;
} | null> {
  const session = await loadStoredSession();
  if (session?.user?.id) {
    return {
      id: session.user.id,
      email: session.user.email,
    };
  }
  return null;
}
