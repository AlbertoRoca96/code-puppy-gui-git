import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sendMessage as apiSendMessage,
  ChatResponse,
  uploadAttachment,
} from '../lib/api';
import {
  hasUploadedAttachment,
  toAttachmentReferences,
} from '../lib/attachments';
import { normalizeDeviceFileUri } from '../lib/devicePaths';
import {
  createSessionId,
  deriveSessionTitle,
  loadSession,
  saveSession,
  SessionAttachment,
  SessionMessage,
} from '../lib/sessions';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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

    if (!options.initialSessionId) {
      setInitialized(true);
      return;
    }

    setIsHydrating(true);
    setInitialized(false);

    loadSession(options.initialSessionId)
      .then((snapshot) => {
        if (cancelled) return;
        setSessionId(snapshot.sessionId || options.initialSessionId || createSessionId());
        setMessages(toUiMessages(snapshot.messages || []));
        setAttachments(snapshot.attachments || []);
        setModel(snapshot.model || DEFAULT_MODEL);
        setPresetId(snapshot.presetId || DEFAULT_PRESET);
        setSystemPrompt(snapshot.systemPrompt || DEFAULT_SYSTEM_PROMPT);
      })
      .catch((error) => {
        console.warn('Failed to load session', error);
        setFailureDebug(
          createFailureDebug('load-session', 'Failed to load session', [String(error)])
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsHydrating(false);
          setInitialized(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [options.initialSessionId]);

  const persistState = async (
    nextMessages: Message[],
    nextComposer = '',
    nextAttachments: SessionAttachment[] = attachments
  ) => {
    const snapshotMessages = toSessionMessages(nextMessages);
    await saveSession(sessionId, {
      sessionId,
      title: deriveSessionTitle(snapshotMessages),
      messages: snapshotMessages,
      composer: nextComposer,
      updatedAt: Date.now() / 1000,
      attachments: nextAttachments,
      model,
      presetId,
      systemPrompt,
    });
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

  const ensureUploadedAttachments = async (): Promise<SessionAttachment[]> => {
    const pending = attachments.filter(
      (attachment) => !hasUploadedAttachment(attachment) && attachment.uri
    );

    if (!pending.length) {
      return attachments;
    }

    const uploaded = await Promise.all(
      pending.map(async (attachment) => {
        const uriInfo = await normalizeDeviceFileUri(attachment.uri);
        if (!uriInfo.normalizedUri) {
          const debug = createFailureDebug(
            'upload-attachment',
            `Attachment URI missing for ${attachment.name}`,
            [JSON.stringify(uriInfo, null, 2)]
          );
          setFailureDebug(debug);
          throw new Error(debug.message);
        }

        try {
          const result = await uploadAttachment({
            uri: uriInfo.normalizedUri,
            name: attachment.name,
            kind: attachment.kind,
            mimeType: attachment.mimeType,
          });
          return {
            ...attachment,
            uri: uriInfo.normalizedUri,
            uploadId: result.uploadId,
            url: result.url || null,
            size: result.size || null,
          } satisfies SessionAttachment;
        } catch (error) {
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

    const merged = attachments.map((attachment) => {
      const replacement = uploaded.find((item) => item.id === attachment.id);
      return replacement || attachment;
    });

    setAttachments(merged);
    await persistState(messages, '', merged);
    return merged;
  };

  const sendMessage = async (prompt: string) => {
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };

    const messagesWithUser = [...messages, userMsg];
    setMessages(messagesWithUser);
    setIsLoading(true);
    setFailureDebug(null);

    try {
      const readyAttachments = await ensureUploadedAttachments();
      await persistState(messagesWithUser, '', readyAttachments);
      const response: ChatResponse = await apiSendMessage({
        messages: toSessionMessages(messagesWithUser),
        model,
        systemPrompt,
        temperature: DEFAULT_TEMPERATURE,
        attachments: toAttachmentReferences(readyAttachments),
      });

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message || 'No response',
        timestamp: new Date(),
      };

      const finalMessages = [...messagesWithUser, assistantMsg];
      setMessages(finalMessages);
      await persistState(finalMessages, '', readyAttachments);
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
      };
      const finalMessages = [...messagesWithUser, errorMsg];
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
