import { apiCall } from './api';

export interface SessionCitation {
  url: string;
  title: string;
}

export interface SessionToolMeta {
  usedWebSearch?: boolean;
  answeredFromRuntime?: boolean;
  fetchedPageCount?: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: SessionAttachment[];
  citations?: SessionCitation[];
  fetchedPages?: SessionCitation[];
  toolMeta?: SessionToolMeta;
}

export type AttachmentStatus =
  | 'pending'
  | 'uploading'
  | 'retrying'
  | 'uploaded'
  | 'error';

export interface SessionAttachment {
  id: string;
  name: string;
  uri?: string | null;
  mimeType?: string | null;
  kind: 'file' | 'image';
  uploadId?: string | null;
  url?: string | null;
  size?: number | null;
  status?: AttachmentStatus;
  progressPct?: number | null;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface SessionSnapshot {
  sessionId: string;
  title?: string;
  messages: SessionMessage[];
  composer?: string;
  presetId?: string | null;
  systemPrompt?: string | null;
  apiBase?: string | null;
  updatedAt?: number;
  model?: string | null;
}

export async function listSessions(limit = 50, query = ''): Promise<SessionSummary[]> {
  const data = await apiCall(
    `/api/sessions?limit=${limit}&query=${encodeURIComponent(query)}`,
    { method: 'GET' }
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function loadSession(sessionId: string): Promise<SessionSnapshot> {
  return apiCall(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
  });
}

export async function saveSession(
  sessionId: string,
  snapshot: SessionSnapshot
): Promise<{ status: string; updatedAt: number }> {
  return apiCall(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    body: JSON.stringify(snapshot),
  });
}

export async function deleteRemoteSession(
  sessionId: string
): Promise<{ status: string }> {
  return apiCall(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export function createSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveSessionTitle(messages: SessionMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage?.content?.trim()) {
    return 'New chat';
  }
  return firstUserMessage.content.trim().slice(0, 80);
}
