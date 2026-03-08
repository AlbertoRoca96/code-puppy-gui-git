import * as SecureStore from 'expo-secure-store';
import type { SessionMessage, SessionAttachment, SessionSummary, SessionSnapshot } from './sessions';

const INDEX_KEY = 'code-puppy:sessions:index:v1';

export interface LocalSessionIndexEntry {
  sessionId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface LocalSessionSnapshot extends SessionSnapshot {}

export interface MergedSessionSummary extends SessionSummary {
  source: 'local' | 'remote' | 'both';
}

async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // ignore storage failures; remote sessions are still source of truth
  }
}

async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore failures
  }
}

export async function loadLocalSessionIndex(): Promise<LocalSessionIndexEntry[]> {
  const raw = await getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalSessionIndexEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export async function saveLocalSessionIndex(entries: LocalSessionIndexEntry[]): Promise<void> {
  const limited = entries
    .filter((entry) => entry.sessionId && entry.title)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100);
  await setItem(INDEX_KEY, JSON.stringify(limited));
}

export async function loadLocalSessionSnapshot(sessionId: string): Promise<LocalSessionSnapshot | null> {
  const raw = await getItem(`code-puppy:session:${sessionId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalSessionSnapshot;
    if (!parsed || parsed.sessionId !== sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveLocalSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
  if (!snapshot.sessionId) return;
  const key = `code-puppy:session:${snapshot.sessionId}`;
  await setItem(key, JSON.stringify(snapshot));

  const index = await loadLocalSessionIndex();
  const messages = snapshot.messages || [];
  const existing = index.filter((entry) => entry.sessionId !== snapshot.sessionId);
  const updated: LocalSessionIndexEntry = {
    sessionId: snapshot.sessionId,
    title: snapshot.title || deriveLocalTitle(messages),
    updatedAt: snapshot.updatedAt || Date.now() / 1000,
    messageCount: messages.length,
  };
  await saveLocalSessionIndex([updated, ...existing]);
}

export async function deleteLocalSession(sessionId: string): Promise<void> {
  const index = await loadLocalSessionIndex();
  const filtered = index.filter((entry) => entry.sessionId !== sessionId);
  await saveLocalSessionIndex(filtered);
  await deleteItem(`code-puppy:session:${sessionId}`);
}

export function mergeLocalAndRemoteSessions(
  local: LocalSessionIndexEntry[],
  remote: SessionSummary[]
): MergedSessionSummary[] {
  const byId: Record<string, MergedSessionSummary> = {};

  for (const entry of remote) {
    byId[entry.sessionId] = { ...entry, source: 'remote' };
  }

  for (const localEntry of local) {
    const existing = byId[localEntry.sessionId];
    if (existing) {
      byId[localEntry.sessionId] = {
        ...existing,
        title: existing.title || localEntry.title,
        updatedAt: Math.max(existing.updatedAt, localEntry.updatedAt),
        messageCount: Math.max(existing.messageCount, localEntry.messageCount),
        source: 'both',
      };
    } else {
      byId[localEntry.sessionId] = {
        sessionId: localEntry.sessionId,
        title: localEntry.title,
        updatedAt: localEntry.updatedAt,
        messageCount: localEntry.messageCount,
        source: 'local',
      };
    }
  }

  return Object.values(byId).sort((a, b) => b.updatedAt - a.updatedAt);
}

function deriveLocalTitle(messages: SessionMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage?.content?.trim()) {
    return 'New chat';
  }
  return firstUserMessage.content.trim().slice(0, 80);
}
