import { Platform } from 'react-native';

import { getAccessToken, getValidAccessToken } from './auth';
import { DEFAULT_API_BASE, getApiBaseCandidates } from './config';
import { clearApiBaseOverride } from './preferences';

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

async function buildAuthHeaders(options: RequestInit = {}, forceRefresh = false) {
  const accessToken = await getValidAccessToken(forceRefresh);
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(options.headers || {}),
  };
}

async function fetchWithApiFallback(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = await buildAuthHeaders(options);
  const fallbackHeaders = await buildAuthHeaders(options, true);
  const candidates = await getApiBaseCandidates();
  let lastError: unknown = null;

  for (const baseUrl of candidates) {
    const url = `${baseUrl}${endpoint}`;
    try {
      let response = await fetch(url, {
        ...options,
        headers,
      });
      if (response.status === 401) {
        response = await fetch(url, {
          ...options,
          headers: fallbackHeaders,
        });
      }
      if (baseUrl === DEFAULT_API_BASE) {
        await clearApiBaseOverride();
      }
      return response;
    } catch (error) {
      lastError = error;
      if (baseUrl === DEFAULT_API_BASE) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

export async function apiCall(endpoint: string, options: RequestInit = {}): Promise<any> {
  const response = await fetchWithApiFallback(endpoint, options);
  const text = await response.text();
  if (!response.ok) {
    try {
      const data = JSON.parse(text);
      throw new Error(
        data.error || data.message || data.detail || `API error: ${response.status}`
      );
    } catch {
      throw new Error(
        `API error ${response.status}: ${text.slice(0, 140).replace(/\s+/g, ' ') || 'Unexpected response'}`
      );
    }
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(
      `JSON Parse error: ${(err as Error).message}. Body starts with: ${text.slice(0, 140).replace(/\s+/g, ' ')}`
    );
  }
}

export interface ChatRequestInput {
  messages: ChatMessageInput[];
  model?: string | null;
  systemPrompt?: string | null;
  temperature?: number | null;
  webSearch?: boolean;
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

export async function sendMessage(input: ChatRequestInput): Promise<ChatResponse> {
  const raw = await apiCall('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: input.messages,
      model: input.model || undefined,
      systemPrompt: input.systemPrompt || undefined,
      temperature: input.temperature ?? undefined,
      attachments: input.attachments || undefined,
      webSearch: input.webSearch || undefined,
    }),
  });
  return {
    message: String(raw.message ?? ''),
    raw: raw.raw,
    usage: raw.usage,
    model: raw.model,
  };
}

export async function streamMessage(
  input: ChatRequestInput,
  handlers: {
    onDelta: (text: string) => void;
    onDone: (message: string, model?: string) => void;
  },
  options: {
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  const accessToken = await getValidAccessToken(false);
  const candidates = await getApiBaseCandidates();
  let response: Response | null = null;
  let lastError: unknown = null;
  for (const baseUrl of candidates) {
    try {
      response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        signal: options.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          messages: input.messages,
          model: input.model || undefined,
          systemPrompt: input.systemPrompt || undefined,
          temperature: input.temperature ?? undefined,
          attachments: input.attachments || undefined,
          webSearch: input.webSearch || undefined,
        }),
      });
      if (baseUrl === DEFAULT_API_BASE) {
        await clearApiBaseOverride();
      }
      break;
    } catch (error) {
      lastError = error;
      response = null;
      if (baseUrl === DEFAULT_API_BASE) {
        throw error;
      }
    }
  }
  if (!response) {
    throw lastError instanceof Error ? lastError : new Error('Streaming request failed');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Streaming request failed (${response.status})`);
  }
  if (!response.body) {
    const fallback = await sendMessage(input);
    handlers.onDone(fallback.message, fallback.model);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const dataLine = chunk
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!dataLine) continue;
      const event = JSON.parse(dataLine) as {
        event?: string;
        content?: string;
        model?: string;
      };
      if (event.event === 'delta' && event.content) {
        fullText += event.content;
        handlers.onDelta(event.content);
      }
      if (event.event === 'done') {
        handlers.onDone(event.content || fullText, event.model);
      }
    }
  }

  if (buffer.trim()) {
    const dataLine = buffer
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice(5)
      .trim();
    if (dataLine) {
      const event = JSON.parse(dataLine) as {
        event?: string;
        content?: string;
        model?: string;
      };
      handlers.onDone(event.content || fullText, event.model);
      return;
    }
  }
  handlers.onDone(fullText);
}

export async function uploadAttachment(
  params: {
    uri: string;
    name: string;
    kind: 'file' | 'image';
    mimeType?: string | null;
  },
  options: {
    onProgress?: (progressPct: number) => void;
  } = {}
): Promise<AttachmentUploadResponse> {
  const accessToken = await getAccessToken();
  const candidates = await getApiBaseCandidates();

  return new Promise((resolve, reject) => {
    let candidateIndex = 0;

    const tryUpload = (apiBase: string) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${apiBase}/api/uploads`);
      if (accessToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && options.onProgress) {
          options.onProgress(
            Math.max(0, Math.min(100, (event.loaded / event.total) * 100))
          );
        }
      };
      xhr.onerror = async () => {
        if (apiBase !== DEFAULT_API_BASE && candidateIndex < candidates.length - 1) {
          candidateIndex += 1;
          await clearApiBaseOverride();
          tryUpload(candidates[candidateIndex]);
          return;
        }
        reject(new Error('Upload failed due to a network error.'));
      };
      xhr.onload = async () => {
        const text = xhr.responseText || '';
        if (xhr.status < 200 || xhr.status >= 300) {
          if (apiBase !== DEFAULT_API_BASE && candidateIndex < candidates.length - 1) {
            candidateIndex += 1;
            await clearApiBaseOverride();
            tryUpload(candidates[candidateIndex]);
            return;
          }
          try {
            const data = JSON.parse(text);
            reject(
              new Error(data.error || data.message || data.detail || 'Upload failed')
            );
          } catch {
            reject(new Error(text || `Upload failed (${xhr.status})`));
          }
          return;
        }
        if (apiBase === DEFAULT_API_BASE) {
          await clearApiBaseOverride();
        }
        try {
          resolve(JSON.parse(text) as AttachmentUploadResponse);
        } catch (error) {
          reject(error);
        }
      };

      const formData = new FormData();
      formData.append('kind', params.kind);
      if (Platform.OS === 'web') {
        fetch(params.uri)
          .then((response) => response.blob())
          .then((blob) => {
            const file = new File([blob], params.name, {
              type: params.mimeType || blob.type || 'application/octet-stream',
            });
            formData.append('file', file);
            xhr.send(formData);
          })
          .catch(reject);
        return;
      }

      formData.append('file', {
        uri: params.uri,
        name: params.name,
        type: params.mimeType || 'application/octet-stream',
      } as any);
      xhr.send(formData);
    };

    tryUpload(candidates[0] || DEFAULT_API_BASE);
  });
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

export async function getHealth(): Promise<{ status: string; messageLimit?: number }> {
  const raw = await apiCall('/api/health', { method: 'GET' });
  return { status: String(raw.status ?? ''), messageLimit: raw.messageLimit };
}

export async function getCurrentUser(): Promise<{ id: string; email?: string | null }> {
  const raw = await apiCall('/api/me', { method: 'GET' });
  return { id: String(raw.id ?? ''), email: raw.email ?? null };
}

export async function cleanupEmptySessions(): Promise<{
  status: string;
  removed: number;
}> {
  const raw = await apiCall('/api/sessions/cleanup-empty', { method: 'POST' });
  return {
    status: String(raw.status ?? ''),
    removed: Number(raw.removed ?? 0),
  };
}
