import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getUpload,
  sendMessage as sendMessageOnce,
  streamMessage,
  uploadAttachment,
} from '../lib/api';
import { toAttachmentReferences } from '../lib/attachments';
import { normalizeDeviceFileUri } from '../lib/devicePaths';
import { loadLocalSessionSnapshot, saveLocalSessionSnapshot } from '../lib/localSessions';
import { loadPreferences } from '../lib/preferences';
import {
  createSessionId,
  deriveSessionTitle,
  loadSession,
  saveSession,
  SessionAttachment,
  SessionMessage,
  SessionSnapshot,
} from '../lib/sessions';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachments?: SessionAttachment[];
}

export interface FailureDebugInfo {
  stage: 'load-session' | 'upload-attachment' | 'send-message' | 'autosave';
  message: string;
  details: string[];
  timestamp: string;
}

interface UseChatOptions {
  initialSessionId?: string | null;
}

const DEFAULT_MODEL = 'hf:zai-org/GLM-4.7';
const DEFAULT_PRESET = 'code-puppy-default';
const DEFAULT_SYSTEM_PROMPT =
  'You are Code Puppy on SYN GLM-4.7. Be concise, cite key assumptions, and end with an actionable checklist.';
const DEFAULT_TEMPERATURE = 0.2;
const MAX_MESSAGES_PER_SESSION = 200;

function toSessionMessages(messages: Message[]): SessionMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    attachments: message.attachments || undefined,
  }));
}

function toUiMessages(messages: SessionMessage[]): Message[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message, index) => ({
      id: `${Date.now()}_${index}`,
      role: message.role as 'user' | 'assistant',
      content: message.content,
      timestamp: new Date(),
      attachments: message.attachments || [],
    }));
}

function createFailureDebug(
  stage: FailureDebugInfo['stage'],
  message: string,
  details: string[] = []
): FailureDebugInfo {
  return { stage, message, details, timestamp: new Date().toISOString() };
}

function isMeaningfulState(messages: Message[], composer = ''): boolean {
  if (messages.some((message) => message.content.trim())) return true;
  return Boolean(composer.trim());
}

export function UseChat(options: UseChatOptions = {}) {
  const [sessionId, setSessionId] = useState(
    options.initialSessionId || createSessionId()
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<SessionAttachment[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [rolloverNotice, setRolloverNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [failureDebug, setFailureDebug] = useState<FailureDebugInfo | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildSnapshot = useCallback(
    (
      targetSessionId: string,
      nextMessages: Message[],
      nextComposer = ''
    ): SessionSnapshot => ({
      sessionId: targetSessionId,
      title: deriveSessionTitle(toSessionMessages(nextMessages)),
      messages: toSessionMessages(nextMessages),
      composer: nextComposer,
      updatedAt: Date.now() / 1000,
      model,
      presetId,
      systemPrompt,
    }),
    [model, presetId, systemPrompt]
  );

  const persistState = useCallback(
    async (targetSessionId: string, nextMessages: Message[], nextComposer = '') => {
      const snapshot = buildSnapshot(targetSessionId, nextMessages, nextComposer);
      if (!isMeaningfulState(nextMessages, nextComposer)) {
        await saveLocalSessionSnapshot(snapshot);
        return;
      }
      await Promise.all([
        saveSession(targetSessionId, snapshot),
        saveLocalSessionSnapshot(snapshot),
      ]);
    },
    [buildSnapshot]
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const prefs = await loadPreferences();
      if (!cancelled) {
        setWebSearchEnabled(Boolean(prefs.webSearchEnabled));
        setStreamingEnabled(prefs.streamingEnabled ?? true);
      }

      if (!options.initialSessionId) {
        setInitialized(true);
        return;
      }

      setIsHydrating(true);
      setInitialized(false);

      try {
        const localSnapshot = await loadLocalSessionSnapshot(options.initialSessionId);
        if (localSnapshot && !cancelled) {
          setSessionId(localSnapshot.sessionId);
          setMessages(toUiMessages(localSnapshot.messages || []));
          setModel(localSnapshot.model || DEFAULT_MODEL);
          setPresetId(localSnapshot.presetId || DEFAULT_PRESET);
          setSystemPrompt(localSnapshot.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        }
      } catch (error) {
        console.warn('Failed to load local session snapshot', error);
      }

      try {
        const snapshot = await loadSession(options.initialSessionId);
        if (!cancelled) {
          setSessionId(
            snapshot.sessionId || options.initialSessionId || createSessionId()
          );
          setMessages(toUiMessages(snapshot.messages || []));
          setModel(snapshot.model || DEFAULT_MODEL);
          setPresetId(snapshot.presetId || DEFAULT_PRESET);
          setSystemPrompt(snapshot.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        }
      } catch (error) {
        console.warn('Failed to load remote session', error);
        setFailureDebug(
          createFailureDebug('load-session', 'Failed to load session from server', [
            String(error),
          ])
        );
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
          setInitialized(true);
        }
      }
    }

    hydrate().catch((error) => console.warn('Unexpected hydrate error', error));
    return () => {
      cancelled = true;
    };
  }, [options.initialSessionId]);

  useEffect(() => {
    if (!initialized || isHydrating || isLoading) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      persistState(sessionId, messages).catch((error) => {
        console.warn('Failed to autosave session metadata', error);
        setFailureDebug(
          createFailureDebug('autosave', 'Failed to autosave session metadata', [
            String(error),
          ])
        );
      });
    }, 600);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [initialized, isHydrating, isLoading, messages, persistState, sessionId]);

  const updateAttachmentStatus = (
    attachmentId: string,
    status: SessionAttachment['status'],
    progressPct?: number | null
  ) => {
    setAttachments((prev) =>
      prev.map((attachment) =>
        attachment.id === attachmentId
          ? {
              ...attachment,
              status,
              progressPct:
                typeof progressPct === 'number'
                  ? progressPct
                  : (attachment.progressPct ?? null),
            }
          : attachment
      )
    );
  };

  const ensureUploadedAttachments = async (
    forceRefresh = false
  ): Promise<SessionAttachment[]> => {
    const resolved = await Promise.all(
      attachments.map(async (attachment) => {
        const uriInfo = attachment.uri
          ? await normalizeDeviceFileUri(attachment.uri)
          : { normalizedUri: attachment.uri, notes: [] as string[] };

        if (attachment.uploadId && !forceRefresh) {
          try {
            await getUpload(attachment.uploadId);
            updateAttachmentStatus(attachment.id, 'uploaded');
            return {
              ...attachment,
              uri: uriInfo.normalizedUri || attachment.uri,
              status: 'uploaded',
            } satisfies SessionAttachment;
          } catch (error) {
            if (!attachment.uri && !uriInfo.normalizedUri) {
              updateAttachmentStatus(attachment.id, 'error');
              throw new Error(
                createFailureDebug(
                  'upload-attachment',
                  `Attachment ${attachment.name} is stale and cannot be re-uploaded`,
                  [String(error)]
                ).message
              );
            }
          }
        }

        if (!uriInfo.normalizedUri) {
          updateAttachmentStatus(attachment.id, 'error');
          throw new Error(
            createFailureDebug(
              'upload-attachment',
              `Attachment URI missing for ${attachment.name}`,
              [JSON.stringify(uriInfo, null, 2)]
            ).message
          );
        }

        updateAttachmentStatus(attachment.id, forceRefresh ? 'retrying' : 'uploading', 0);
        const result = await uploadAttachment(
          {
            uri: uriInfo.normalizedUri,
            name: attachment.name,
            kind: attachment.kind,
            mimeType: attachment.mimeType,
          },
          {
            onProgress: (progressPct) => {
              updateAttachmentStatus(attachment.id, 'uploading', progressPct);
            },
          }
        );
        updateAttachmentStatus(attachment.id, 'uploaded', 100);
        return {
          ...attachment,
          uri: uriInfo.normalizedUri,
          uploadId: result.uploadId,
          url: result.url || null,
          size: result.size || null,
          status: 'uploaded',
          progressPct: 100,
        } satisfies SessionAttachment;
      })
    );

    setAttachments(resolved);
    return resolved;
  };

  const cancelStreaming = () => {
    abortControllerRef.current?.abort();
  };

  const sendMessage = async (prompt: string) => {
    const rollover = messages.length >= MAX_MESSAGES_PER_SESSION;
    const activeSessionId = rollover ? createSessionId() : sessionId;
    const baseMessages = rollover ? [] : messages;
    const draftUserMsg: Message = {
      id: `${Date.now()}_user`,
      role: 'user',
      content: prompt,
      timestamp: new Date(),
      attachments: [],
    };
    const optimisticMessages = [...baseMessages, draftUserMsg];

    if (rollover) {
      setSessionId(activeSessionId);
      setMessages([]);
      setAttachments([]);
      setRolloverNotice(
        `Message cap reached (${MAX_MESSAGES_PER_SESSION}). Started a fresh chat so your older thread stays intact.`
      );
    } else {
      setRolloverNotice(null);
    }

    setMessages(optimisticMessages);
    setIsLoading(true);
    setFailureDebug(null);

    try {
      const readyAttachments = await ensureUploadedAttachments();
      const userMsg: Message = { ...draftUserMsg, attachments: readyAttachments };
      const messagesWithUser = [...baseMessages, userMsg];
      setMessages(messagesWithUser);
      await persistState(activeSessionId, messagesWithUser);

      const assistantId = `${Date.now()}_assistant`;
      const streamingPlaceholder: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        attachments: [],
      };
      setMessages([...messagesWithUser, streamingPlaceholder]);

      let finalAssistantText = '';
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(streamingEnabled);

      if (!streamingEnabled) {
        const fallback = await sendMessageOnce({
          messages: toSessionMessages(messagesWithUser),
          model,
          systemPrompt,
          temperature: DEFAULT_TEMPERATURE,
          attachments: toAttachmentReferences(readyAttachments),
          webSearch: webSearchEnabled,
        });
        finalAssistantText = fallback.message || 'No response';
        setMessages((prev) =>
          prev.map((item) =>
            item.id === assistantId ? { ...item, content: finalAssistantText } : item
          )
        );
      } else {
        try {
          await streamMessage(
            {
              messages: toSessionMessages(messagesWithUser),
              model,
              systemPrompt,
              temperature: DEFAULT_TEMPERATURE,
              attachments: toAttachmentReferences(readyAttachments),
              webSearch: webSearchEnabled,
            },
            {
              onDelta: (text) => {
                finalAssistantText += text;
                setMessages((prev) =>
                  prev.map((item) =>
                    item.id === assistantId
                      ? { ...item, content: finalAssistantText }
                      : item
                  )
                );
              },
              onDone: (message) => {
                finalAssistantText = message || finalAssistantText || 'No response';
                setMessages((prev) =>
                  prev.map((item) =>
                    item.id === assistantId
                      ? { ...item, content: finalAssistantText }
                      : item
                  )
                );
              },
            },
            { signal: controller.signal }
          );
        } catch (error) {
          const isAbort = error instanceof Error && error.name === 'AbortError';
          if (isAbort) {
            throw error;
          }
          console.warn('Streaming failed; falling back to one-shot chat request', error);
          const fallback = await sendMessageOnce({
            messages: toSessionMessages(messagesWithUser),
            model,
            systemPrompt,
            temperature: DEFAULT_TEMPERATURE,
            attachments: toAttachmentReferences(readyAttachments),
            webSearch: webSearchEnabled,
          });
          finalAssistantText = fallback.message || 'No response';
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantId ? { ...item, content: finalAssistantText } : item
            )
          );
        }
      }

      const finalMessages = [
        ...messagesWithUser,
        { ...streamingPlaceholder, content: finalAssistantText || 'No response' },
      ];
      setMessages(finalMessages);
      setAttachments([]);
      await persistState(activeSessionId, finalMessages);
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const msg = isAbort
        ? 'Streaming cancelled.'
        : error instanceof Error
          ? error.message
          : String(error);
      if (!isAbort) {
        console.error('Error sending message:', error);
      }
      setFailureDebug(
        createFailureDebug(
          'send-message',
          isAbort ? 'Stream cancelled' : 'Chat request failed',
          [
            `sessionId=${activeSessionId}`,
            `model=${model}`,
            `attachments=${attachments.length}`,
            msg,
          ]
        )
      );
      const errorMsg: Message = {
        id: `${Date.now()}_error`,
        role: 'assistant',
        content: isAbort ? 'Streaming stopped.' : `Error: ${msg}`,
        timestamp: new Date(),
        attachments: [],
      };
      const finalMessages = [...optimisticMessages, errorMsg];
      setMessages(finalMessages);
      await persistState(activeSessionId, finalMessages);
      if (!isAbort) {
        throw error;
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    setSessionId(createSessionId());
    setMessages([]);
    setAttachments([]);
    setFailureDebug(null);
    setInitialized(true);
  };

  const addAttachment = (attachment: SessionAttachment) => {
    setAttachments((prev) => [...prev, attachment]);
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  };

  const clearFailureDebug = () => {
    setFailureDebug(null);
  };

  const title = useMemo(
    () => deriveSessionTitle(toSessionMessages(messages)),
    [messages]
  );

  return {
    sessionId,
    title,
    messages,
    attachments,
    model,
    presetId,
    systemPrompt,
    webSearchEnabled,
    streamingEnabled,
    rolloverNotice,
    isLoading,
    isHydrating,
    isStreaming,
    failureDebug,
    maxMessagesPerSession: MAX_MESSAGES_PER_SESSION,
    sendMessage,
    cancelStreaming,
    startNewChat,
    addAttachment,
    removeAttachment,
    clearFailureDebug,
    setModel,
    setPresetId,
    setSystemPrompt,
    setWebSearchEnabled,
    setStreamingEnabled,
    setRolloverNotice,
  };
}
