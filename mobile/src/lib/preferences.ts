import { deletePersistentItem, getPersistentItem, setPersistentItem } from './storage';

const PREFS_KEY = 'code-puppy:preferences:v1';

export interface AppPreferences {
  apiBaseOverride?: string;
  webSearchEnabled?: boolean;
  streamingEnabled?: boolean;
}

export async function loadPreferences(): Promise<AppPreferences> {
  const raw = await getPersistentItem(PREFS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AppPreferences;
  } catch {
    return {};
  }
}

export async function savePreferences(next: AppPreferences): Promise<void> {
  await setPersistentItem(PREFS_KEY, JSON.stringify(next));
}

export async function clearPreferences(): Promise<void> {
  await deletePersistentItem(PREFS_KEY);
}
