import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sendMessage as apiSendMessage,
  ChatResponse,
  getUpload,
  uploadAttachment,
} from '../lib/api';
import {
  hasUploadedAttachment,
  toAttachmentReferences,
} from '../lib/attachments';
import { normalizeDeviceFileUri } from '../lib/devicePaths';
import {
  loadLocalSessionSnapshot,
  saveLocalSessionSnapshot,
} from '../lib/localSessions';
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
  return {
    stage,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
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
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [failureDebug, setFailureDebug] = useState<FailureDebugInfo | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
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
          setAttachments([]);
          setModel(localSnapshot.model || DEFAULT_MODEL);
          setPresetId(localSnapshot.presetId || DEFAULT_PRESET);
          setSystemPrompt(localSnapshot.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        }
      } catch (error) {
        console.warn('Failed to load local session snapshot', error);
      }

      loadSession(options.initialSessionId)
        .then((snapshot) => {
          if (cancelled) return;
          setSessionId(snapshot.sessionId || options.initialSessionId || createSessionId());
          setMessages(toUiMessages(snapshot.messages || []));
          setAttachments([]);
          setModel(snapshot.model || DEFAULT_MODEL);
          setPresetId(snapshot.presetId || DEFAULT_PRESET);
          setSystemPrompt(snapshot.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        })
        .catch((error) => {
          console.warn('Failed to load remote session', error);
          setFailureDebug(
            createFailureDebug('load-session', 'Failed to load session from server', [
              String(error),
            ])
          );
        })
        .finally(() => {
          if (!cancelled) {
            setIsHydrating(false);
            setInitialized(true);
          }
        });
    }

    hydrate().catch((error) => {
      console.warn('Unexpected hydrate error', error);
    });

    return () => {
      cancelled = true;
    };
  }, [options.initialSessionId]);

  const updateAttachmentStatus = (
    attachmentId: string,
    status: SessionAttachment['status']
  ) => {
    setAttachments((prev) =>
      prev.map((attachment) =>
        attachment.id === attachmentId ? { ...attachment, status } : attachment
      )
    );
  };

  const buildSnapshot = (
    nextMessages: Message[],
    nextComposer = '',
    nextAttachments: SessionAttachment[] = attachments
  ): SessionSnapshot => {
    const snapshotMessages = toSessionMessages(nextMessages);
    return {
      sessionId,
      title: deriveSessionTitle(snapshotMessages),
      messages: snapshotMessages,
      composer: nextComposer,
      updatedAt: Date.now() / 1000,
      model,
      presetId,
      systemPrompt,
    };
  };

  const persistState = async (
    nextMessages: Message[],
    nextComposer = '',
    nextAttachments: SessionAttachment[] = attachments
  ) => {
    const snapshot = buildSnapshot(nextMessages, nextComposer, nextAttachments);
    await Promise.all([
      saveSession(sessionId, snapshot),
      saveLocalSessionSnapshot(snapshot),
    ]);
  };

  useEffect(() => {
    if (!initialized || isHydrating || isLoading) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      persistState(messages).catch((error) => {
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
  }, [initialized, isHydrating, isLoading, sessionId, messages, attachments, model, presetId, systemPrompt]);

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
              const debug = createFailureDebug(
                'upload-attachment',
                `Attachment ${attachment.name} is stale and cannot be re-uploaded`,
                [String(error)]
              );
              setFailureDebug(debug);
              throw new Error(debug.message);
            }
          }
        }

        if (!uriInfo.normalizedUri) {
          updateAttachmentStatus(attachment.id, 'error');
          const debug = createFailureDebug(
            'upload-attachment',
            `Attachment URI missing for ${attachment.name}`,
            [JSON.stringify(uriInfo, null, 2)]
          );
          setFailureDebug(debug);
          throw new Error(debug.message);
        }

        try {
          updateAttachmentStatus(
            attachment.id,
            forceRefresh ? 'retrying' : 'uploading'
          );
          const result = await uploadAttachment({
            uri: uriInfo.normalizedUri,
            name: attachment.name,
            kind: attachment.kind,
            mimeType: attachment.mimeType,
          });
          updateAttachmentStatus(attachment.id, 'uploaded');
          return {
            ...attachment,
            uri: uriInfo.normalizedUri,
            uploadId: result.uploadId,
            url: result.url || null,
            size: result.size || null,
            status: 'uploaded',
          } satisfies SessionAttachment;
        } catch (error) {
          updateAttachmentStatus(attachment.id, 'error');
          const debug = createFailureDebug(
            'upload-attachment',
            `Attachment upload failed for ${attachment.name}`,
            [JSON.stringify(uriInfo, null, 2), String(error)]
          );
          setFailureDebug(debug);
          throw error;
        }
      })
    );

    setAttachments(resolved);
    await persistState(messages);
    return resolved;
  };

  const sendMessage = async (prompt: string) => {
    const draftUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
      attachments: [],
    };

    const optimisticMessages = [...messages, draftUserMsg];
    setMessages(optimisticMessages);
    setIsLoading(true);
    setFailureDebug(null);

    try {
      let readyAttachments = await ensureUploadedAttachments();
      const userMsg: Message = {
        ...draftUserMsg,
        attachments: readyAttachments,
      };
      const messagesWithUser = [...messages, userMsg];
      setMessages(messagesWithUser);
      await persistState(messagesWithUser);

      let response: ChatResponse;
      try {
        response = await apiSendMessage({
          messages: toSessionMessages(messagesWithUser),
          model,
          systemPrompt,
          temperature: DEFAULT_TEMPERATURE,
          attachments: toAttachmentReferences(readyAttachments),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('Upload not found') && readyAttachments.length > 0) {
          readyAttachments = await ensureUploadedAttachments(true);
          const retriedUserMsg: Message = {
            ...userMsg,
            attachments: readyAttachments,
          };
          const retriedMessagesWithUser = [...messages, retriedUserMsg];
          setMessages(retriedMessagesWithUser);
          await persistState(retriedMessagesWithUser);
          response = await apiSendMessage({
            messages: toSessionMessages(retriedMessagesWithUser),
            model,
            systemPrompt,
            temperature: DEFAULT_TEMPERATURE,
            attachments: toAttachmentReferences(readyAttachments),
          });
        } else {
          throw error;
        }
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message || 'No response',
        timestamp: new Date(),
        attachments: [],
      };

      const finalMessages = [...messagesWithUser, assistantMsg];
      setMessages(finalMessages);
      setAttachments([]);
      await persistState(finalMessages);
    } catch (error) {
      console.error('Error sending message:', error);
      const msg = error instanceof Error ? error.message : String(error);
      if (!failureDebug) {
        setFailureDebug(
          createFailureDebug('send-message', 'Chat request failed', [
            `sessionId=${sessionId}`,
            `model=${model}`,
            `attachments=${attachments.length}`,
            msg,
          ])
        );
      }
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${msg}`,
        timestamp: new Date(),
        attachments: [],
      };
      const finalMessages = [...optimisticMessages, errorMsg];
      setMessages(finalMessages);
      try {
        await persistState(finalMessages);
      } catch (persistError) {
        console.warn('Failed to persist error state', persistError);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    const nextSessionId = createSessionId();
    setSessionId(nextSessionId);
    setMessages([]);
    setAttachments([]);
    setModel(DEFAULT_MODEL);
    setPresetId(DEFAULT_PRESET);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
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
    isLoading,
    isHydrating,
    failureDebug,
    sendMessage,
    startNewChat,
    addAttachment,
    removeAttachment,
    clearFailureDebug,
    setModel,
    setPresetId,
    setSystemPrompt,
  };
}
