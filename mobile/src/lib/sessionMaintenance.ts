import { cleanupEmptySessions } from './api';
import { loadLocalSessionIndex, saveLocalSessionIndex } from './localSessions';
import { deletePersistentItem, getPersistentItem, setPersistentItem } from './storage';

let cleanupPromise: Promise<void> | null = null;
const CLEANUP_FLAG_KEY = 'code-puppy:sessions:cleanup-empty:v2';

async function cleanupLocalEmptySessions(): Promise<void> {
  const index = await loadLocalSessionIndex();
  const kept = index.filter((entry) => entry.messageCount > 0);
  const removed = index.filter((entry) => entry.messageCount <= 0);
  for (const entry of removed) {
    await deletePersistentItem(`code-puppy:session:${entry.sessionId}`);
  }
  await saveLocalSessionIndex(kept);
}

export async function cleanupEmptySessionsOnce(): Promise<void> {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      const alreadyRan = await getPersistentItem(CLEANUP_FLAG_KEY);
      if (alreadyRan === 'done') return;
      await cleanupLocalEmptySessions();
      try {
        await cleanupEmptySessions();
      } catch (error) {
        console.warn('Remote empty-session cleanup skipped', error);
      }
      await setPersistentItem(CLEANUP_FLAG_KEY, 'done');
    })().finally(() => {
      cleanupPromise = null;
    });
  }
  await cleanupPromise;
}
