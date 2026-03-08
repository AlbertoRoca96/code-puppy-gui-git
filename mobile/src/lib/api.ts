// Code Puppy API client for Puppy Chat mobile app

import { getAccessToken } from './auth';

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AttachmentUploadResponse {
  uploadId: string;
  name: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  size?: number | null;
  url?: string | null;
  createdAt?: number;
}

async function buildAuthHeaders(options: RequestInit = {}) {
  const accessToken = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(options.headers || {}),
  };
}

export async function apiCall(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const API_BASE = __DEV__
    ? 'http://localhost:8000'
    : 'https://code-puppy-api.fly.dev';

  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: await buildAuthHeaders(options),
  });

  const text = await response.text();

  if (!response.ok) {
    try {
      const data = JSON.parse(text);
      const msg = data.error || data.message || data.detail || `API error: ${response.status}`;
      throw new Error(msg);
    } catch {
      const snippet = text.slice(0, 140).replace(/\s+/g, ' ');
      throw new Error(
        `API error ${response.status}: ${snippet || 'Unexpected response'}`
      );
    }
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    const snippet = text.slice(0, 140).replace(/\s+/g, ' ');
    throw new Error(
      `JSON Parse error: ${(err as Error).message}. Body starts with: ${snippet}`
    );
  }
}

function getApiBase(): string {
  return __DEV__ ? 'http://localhost:8000' : 'https://code-puppy-api.fly.dev';
}

export interface ChatRequestInput {
  messages: ChatMessageInput[];
  model?: string | null;
  systemPrompt?: string | null;
  temperature?: number | null;
  attachments?: {
    id: string;
    name: string;
    kind: 'file' | 'image';
    mimeType?: string | null;
    uri?: string | null;
    uploadId?: string | null;
    url?: string | null;
    size?: number | null;
  }[];
}

export interface ChatResponse {
  message: string;
  raw?: any;
  usage?: any;
  model?: string;
}

export interface HealthStatus {
  status: string;
}

export async function sendMessage({
  messages,
  model,
  systemPrompt,
  temperature,
  attachments,
}: ChatRequestInput): Promise<ChatResponse> {
  const raw = await apiCall('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages,
      model: model || undefined,
      systemPrompt: systemPrompt || undefined,
      temperature: temperature ?? undefined,
      attachments: attachments || undefined,
    }),
  });

  return {
    message: String(raw.message ?? ''),
    raw: raw.raw,
    usage: raw.usage,
    model: raw.model,
  };
}

export async function uploadAttachment(params: {
  uri: string;
  name: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
}): Promise<AttachmentUploadResponse> {
  const formData = new FormData();
  formData.append('kind', params.kind);
  formData.append('file', {
    uri: params.uri,
    name: params.name,
    type: params.mimeType || 'application/octet-stream',
  } as any);

  const accessToken = await getAccessToken();
  const response = await fetch(`${getApiBase()}/api/uploads`, {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: formData,
  });

  const text = await response.text();
  if (!response.ok) {
    try {
      const data = JSON.parse(text);
      throw new Error(data.error || data.message || data.detail || 'Upload failed');
    } catch {
      throw new Error(text || `Upload failed (${response.status})`);
    }
  }

  if (!text) {
    throw new Error('Upload endpoint returned an empty response body');
  }
  return JSON.parse(text) as AttachmentUploadResponse;
}

export async function getUpload(uploadId: string): Promise<AttachmentUploadResponse> {
  const raw = await apiCall(`/api/upload/${encodeURIComponent(uploadId)}`, {
    method: 'GET',
  });
  return {
    uploadId: String(raw.uploadId ?? uploadId),
    name: String(raw.name ?? ''),
    kind: (raw.kind ?? 'file') as 'file' | 'image',
    mimeType: raw.mimeType ?? null,
    size: raw.size ?? null,
    url: raw.url ?? null,
    createdAt: raw.createdAt,
  };
}

export async function getHealth(): Promise<HealthStatus> {
  const raw = await apiCall('/api/health', { method: 'GET' });
  return {
    status: String(raw.status ?? ''),
  };
}
