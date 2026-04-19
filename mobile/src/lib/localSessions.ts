import type { SessionMessage, SessionSummary, SessionSnapshot } from './sessions';
import { deletePersistentItem, getPersistentItem, setPersistentItem } from './storage';

const INDEX_KEY = 'code-puppy:sessions:index:v2';

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

function isMeaningfulSnapshot(
  snapshot: Partial<SessionSnapshot> | null | undefined
): boolean {
  if (!snapshot) return false;
  const messages = snapshot.messages || [];
  if (messages.some((message) => message.role !== 'system' && message.content?.trim())) {
    return true;
  }
  return Boolean(snapshot.composer?.trim());
}

export async function loadLocalSessionIndex(): Promise<LocalSessionIndexEntry[]> {
  const raw = await getPersistentItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalSessionIndexEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry.messageCount > 0);
  } catch {
    return [];
  }
}

export async function saveLocalSessionIndex(
  entries: LocalSessionIndexEntry[]
): Promise<void> {
  const limited = entries
    .filter((entry) => entry.sessionId && entry.title && entry.messageCount > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100);
  await setPersistentItem(INDEX_KEY, JSON.stringify(limited));
}

export async function loadLocalSessionSnapshot(
  sessionId: string
): Promise<LocalSessionSnapshot | null> {
  const raw = await getPersistentItem(`code-puppy:session:${sessionId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalSessionSnapshot;
    if (!parsed || parsed.sessionId !== sessionId) return null;
    return isMeaningfulSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveLocalSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
  if (!snapshot.sessionId) return;
  const key = `code-puppy:session:${snapshot.sessionId}`;
  if (!isMeaningfulSnapshot(snapshot)) {
    await deletePersistentItem(key);
    const index = await loadLocalSessionIndex();
    await saveLocalSessionIndex(
      index.filter((entry) => entry.sessionId !== snapshot.sessionId)
    );
    return;
  }

  await setPersistentItem(key, JSON.stringify(snapshot));
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
  await saveLocalSessionIndex(index.filter((entry) => entry.sessionId !== sessionId));
  await deletePersistentItem(`code-puppy:session:${sessionId}`);
}

export function mergeLocalAndRemoteSessions(
  local: LocalSessionIndexEntry[],
  remote: SessionSummary[]
): MergedSessionSummary[] {
  const byId: Record<string, MergedSessionSummary> = {};
  for (const entry of remote.filter((item) => item.messageCount > 0)) {
    byId[entry.sessionId] = { ...entry, source: 'remote' };
  }
  for (const localEntry of local.filter((item) => item.messageCount > 0)) {
    const existing = byId[localEntry.sessionId];
    byId[localEntry.sessionId] = existing
      ? {
          ...existing,
          title: existing.title || localEntry.title,
          updatedAt: Math.max(existing.updatedAt, localEntry.updatedAt),
          messageCount: Math.max(existing.messageCount, localEntry.messageCount),
          source: 'both',
        }
      : {
          sessionId: localEntry.sessionId,
          title: localEntry.title,
          updatedAt: localEntry.updatedAt,
          messageCount: localEntry.messageCount,
          source: 'local',
        };
  }
  return Object.values(byId).sort((a, b) => b.updatedAt - a.updatedAt);
}

function deriveLocalTitle(messages: SessionMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage?.content?.trim()) return 'New chat';
  return firstUserMessage.content.trim().slice(0, 80);
}
