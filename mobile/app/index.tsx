import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { UseChat } from '../src/hooks/useChat';
import { getCurrentUser, getHealth } from '../src/lib/api';
import { getCurrentSessionUser, loadStoredSession, signOut } from '../src/lib/auth';
import { useDeviceUi } from '../src/lib/device';

const BG = '#050816';
const CARD_BG = '#0b1020';
const ACCENT = '#ff4ecf';
const ACCENT_SOFT = '#1e293b';
const USER_BUBBLE = '#1d4ed8';
const ASSIST_BUBBLE = '#020617';
const ERROR_BG = '#3f0d1b';

const MODEL_OPTIONS = [
  'hf:zai-org/GLM-4.7',
  'openai:gpt-4.1-mini',
  'openai:gpt-4.1',
];

const PRESET_OPTIONS = [
  {
    id: 'code-puppy-default',
    label: 'Code Puppy default',
    prompt:
      'You are Code Puppy on SYN GLM-4.7. Be concise, cite key assumptions, and end with an actionable checklist.',
  },
  {
    id: 'debugger',
    label: 'Debugger',
    prompt:
      'You are Code Puppy in debugger mode. Focus on reproduction steps, root cause analysis, and exact fixes.',
  },
  {
    id: 'architect',
    label: 'Architect',
    prompt:
      'You are Code Puppy in architect mode. Propose scalable designs, tradeoffs, and implementation phases.',
  },
];

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const initialSessionId = useMemo(() => {
    const raw = params.sessionId;
    return typeof raw === 'string' ? raw : null;
  }, [params.sessionId]);

  const {
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
  } = UseChat({ initialSessionId });

  const [input, setInput] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [statusText, setStatusText] = useState(
    'Woof! Tap "Check backend" to verify connectivity.'
  );
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [showModelControls, setShowModelControls] = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const deviceUi = useDeviceUi();

  useEffect(() => {
    loadStoredSession()
      .then(async (session) => {
        if (!session?.access_token) {
          router.replace('/auth' as any);
          return;
        }
        const localUser = await getCurrentSessionUser();
        if (localUser?.email) {
          setCurrentUserEmail(localUser.email);
        }
        try {
          const remoteUser = await getCurrentUser();
          if (remoteUser.email) {
            setCurrentUserEmail(remoteUser.email);
          }
        } catch (error) {
          console.warn('Failed to fetch current user', error);
        }
      })
      .finally(() => setAuthChecked(true));
  }, [router]);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/auth' as any);
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || isHydrating) return;
    try {
      await sendMessage(trimmed);
      setInput('');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatusText(`Send failed: ${msg}`);
    }
  };

  const handleCheckHealth = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const health = await getHealth();
      setStatusText(`Backend status: ${health.status || 'unknown'}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatusText(`Status failed: ${msg}`.trim());
    } finally {
      setChecking(false);
    }
  };

  const handleNewChat = () => {
    startNewChat();
    setInput('');
    router.replace('/');
  };

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    addAttachment({
      id: `${Date.now()}_file`,
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      kind: 'file',
      uploadId: null,
      url: null,
      size: asset.size ?? null,
      status: 'pending',
    });
  };

  const handlePickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatusText('Photos permission denied. Go yell at iOS, not me.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    addAttachment({
      id: `${Date.now()}_image`,
      name: asset.fileName || 'photo.jpg',
      uri: asset.uri,
      mimeType: asset.mimeType,
      kind: 'image',
      uploadId: null,
      url: null,
      size: asset.fileSize ?? null,
      status: 'pending',
    });
  };

  const applyPreset = (nextPresetId: string) => {
    const preset = PRESET_OPTIONS.find((item) => item.id === nextPresetId);
    setPresetId(nextPresetId);
    if (preset) {
      setSystemPrompt(preset.prompt);
    }
  };

  const handleHeaderLongPress = () => {
    // Hidden debug entry: long-press the title block to open storage debug.
    router.push('/debug-storage' as any);
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  };

  const handleMessagesContentSizeChange = () => {
    scrollToBottom();
  };

  const handleMessagesLayout = () => {
    scrollToBottom();
  };

  const handleMessagesScrollBeginDrag = (
    _event: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    Keyboard.dismiss();
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, attachments.length, headerCollapsed]);

  if (!authChecked) {
    return null;
  }

  if (!currentUserEmail) {
    return <Redirect href={'/auth' as any} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={[styles.container, deviceUi.isWeb && styles.webContainer]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}
      >
        <View style={[styles.headerWrapper, deviceUi.isWide && styles.webShell]}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity
              style={styles.headerPill}
              onPress={() =>
                router.push(`/sessions?sessionId=${encodeURIComponent(sessionId)}` as any)
              }
            >
              <Text style={styles.headerPillText}>Chats</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerPill} onPress={handleNewChat}>
              <Text style={styles.headerPillText}>New chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerPill} onPress={handleSignOut}>
              <Text style={styles.headerPillText}>Sign out</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.headerCard}
            onLongPress={handleHeaderLongPress}
            activeOpacity={0.95}
          >
            <View style={styles.headerTitleRow}>
              <View style={styles.headerTitleCopy}>
                <Text style={styles.title}>Code PuppyChat</Text>
                {!headerCollapsed ? (
                  <Text style={styles.subtitle}>
                    Selectable models, persistent sessions, and real file uploads.
                  </Text>
                ) : null}
                {currentUserEmail ? (
                  <Text style={styles.subtitle}>Signed in as {currentUserEmail}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.collapseButton}
                onPress={() => setHeaderCollapsed((prev) => !prev)}
              >
                <Text style={styles.collapseButtonText}>
                  {headerCollapsed ? 'Expand' : 'Minimize'}
                </Text>
              </TouchableOpacity>
            </View>

            {!headerCollapsed ? (
              <>
                <Text style={styles.sessionText}>Session: {sessionId}</Text>
                <Text style={styles.sessionText}>Title: {title}</Text>
                <Text style={styles.sessionText}>Model: {model}</Text>
                <Text style={styles.sessionText}>Preset: {presetId}</Text>
                <Text style={styles.status}>{statusText}</Text>
              </>
            ) : (
              <Text style={styles.sessionText}>Title: {title}</Text>
            )}

            <View style={styles.headerButtonRow}>
              <TouchableOpacity
                style={styles.statusButton}
                onPress={handleCheckHealth}
                disabled={checking}
              >
                <Text style={styles.statusButtonText}>
                  {checking ? 'Checking…' : 'Check backend'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setShowModelControls((prev) => !prev)}
              >
                <Text style={styles.secondaryButtonText}>
                  {showModelControls ? 'Hide controls' : 'Models & tools'}
                </Text>
              </TouchableOpacity>
            </View>

            {!headerCollapsed && failureDebug ? (
              <View style={styles.debugCard}>
                <View style={styles.debugHeader}>
                  <Text style={styles.debugTitle}>Failure debug</Text>
                  <TouchableOpacity onPress={clearFailureDebug}>
                    <Text style={styles.debugDismiss}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.debugText}>
                  [{failureDebug.stage}] {failureDebug.message}
                </Text>
                <Text style={styles.debugText}>{failureDebug.timestamp}</Text>
                {failureDebug.details.map((detail, index) => (
                  <Text key={`${failureDebug.timestamp}_${index}`} style={styles.debugDetail}>
                    {detail}
                  </Text>
                ))}
              </View>
            ) : null}

            {!headerCollapsed && showModelControls && (
              <View style={styles.controlsCard}>
                <Text style={styles.controlLabel}>Model</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.optionRow}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.optionChip,
                        model === option && styles.optionChipActive,
                      ]}
                      onPress={() => setModel(option)}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          model === option && styles.optionChipTextActive,
                        ]}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.controlLabel}>Preset</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.optionRow}
                >
                  {PRESET_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.optionChip,
                        presetId === option.id && styles.optionChipActive,
                      ]}
                      onPress={() => applyPreset(option.id)}
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          presetId === option.id && styles.optionChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.controlLabel}>System prompt</Text>
                <TextInput
                  style={styles.promptInput}
                  multiline
                  value={systemPrompt}
                  onChangeText={setSystemPrompt}
                  placeholder="How should Code Puppy think?"
                  placeholderTextColor="#6b7280"
                />
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.chatWrapper, deviceUi.isWide && styles.webShell, deviceUi.isWide && styles.webChatWrapper]}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.messages}
            contentContainerStyle={
              messages.length === 0 ? styles.emptyContainer : styles.messagesContent
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onContentSizeChange={handleMessagesContentSizeChange}
            onLayout={handleMessagesLayout}
            onScrollBeginDrag={handleMessagesScrollBeginDrag}
            scrollEventThrottle={16}
          >
            {messages.length === 0 ? (
              <Text style={styles.emptyText}>
                {isHydrating
                  ? 'Loading chat history…'
                  : 'Woof! System online. Ready for code, files, and chaos.'}
              </Text>
            ) : (
              messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.bubble,
                    msg.role === 'user'
                      ? styles.userBubble
                      : styles.assistantBubble,
                  ]}
                >
                  <Text
                    selectable
                    style={
                      msg.role === 'user'
                        ? styles.userText
                        : styles.assistantText
                    }
                  >
                    {msg.content}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>

        <View style={[styles.footer, deviceUi.isWide && styles.webShell, deviceUi.isWide && styles.webFooter]}>
          <View style={styles.attachRow}>
            <TouchableOpacity style={styles.attachButton} onPress={handlePickFile}>
              <Text style={styles.attachButtonText}>+ File</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachButton} onPress={handlePickPhoto}>
              <Text style={styles.attachButtonText}>+ Photo</Text>
            </TouchableOpacity>
          </View>

          {attachments.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsRow}
            >
              {attachments.map((attachment) => {
                const statusLabel =
                  attachment.status === 'uploading'
                    ? 'uploading…'
                    : attachment.status === 'retrying'
                    ? 'retrying…'
                    : attachment.status === 'uploaded'
                    ? 'sent'
                    : attachment.status === 'error'
                    ? 'failed'
                    : 'queued';

                return (
                  <TouchableOpacity
                    key={attachment.id}
                    style={styles.attachmentChip}
                    onPress={() => removeAttachment(attachment.id)}
                  >
                    <Text style={styles.attachmentChipText}>
                      {attachment.kind === 'image' ? '🖼' : '📎'} {attachment.name} · {statusLabel} ×
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <TextInput
            style={styles.input}
            placeholder="Enter a coding task"
            placeholderTextColor="#6b7280"
            value={input}
            onChangeText={setInput}
            editable={!isLoading && !isHydrating}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            onFocus={() => setHeaderCollapsed(true)}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!input.trim() || isLoading || isHydrating) &&
                styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!input.trim() || isLoading || isHydrating}
          >
            <Text style={styles.sendText}>
              {isHydrating
                ? 'Loading history…'
                : isLoading
                  ? 'Uploading snacks & summoning puppy…'
                  : 'Send to Code Puppy'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  webContainer: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 1180,
  },
  headerWrapper: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  webShell: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerPill: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerPillText: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  headerCard: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#111827',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitleCopy: {
    flex: 1,
  },
  collapseButton: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  collapseButtonText: {
    color: '#f9fafb',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f9fafb',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#d1d5db',
  },
  sessionText: {
    marginTop: 8,
    fontSize: 12,
    color: '#9ca3af',
  },
  status: {
    marginTop: 10,
    fontSize: 13,
    color: '#e5e7eb',
  },
  headerButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  statusButton: {
    alignSelf: 'flex-start',
    backgroundColor: ACCENT,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusButtonText: {
    color: '#0b1120',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  secondaryButtonText: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '600',
  },
  debugCard: {
    marginTop: 12,
    backgroundColor: ERROR_BG,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    borderRadius: 14,
    padding: 12,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  debugTitle: {
    color: '#fecaca',
    fontWeight: '800',
  },
  debugDismiss: {
    color: '#fda4af',
    fontWeight: '700',
  },
  debugText: {
    color: '#ffe4e6',
    fontSize: 12,
    marginBottom: 4,
  },
  debugDetail: {
    color: '#fecdd3',
    fontSize: 11,
    marginTop: 6,
  },
  controlsCard: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 12,
  },
  controlLabel: {
    color: '#f9fafb',
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 8,
  },
  optionRow: {
    marginBottom: 6,
  },
  optionChip: {
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  optionChipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  optionChipText: {
    color: '#f9fafb',
    fontSize: 12,
  },
  optionChipTextActive: {
    color: '#0b1120',
    fontWeight: '700',
  },
  promptInput: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#020617',
    color: '#f9fafb',
    minHeight: 96,
    textAlignVertical: 'top',
  },
  chatWrapper: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  webChatWrapper: {
    minHeight: 420,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingBottom: 20,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 14,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: USER_BUBBLE,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: ASSIST_BUBBLE,
    borderWidth: 1,
    borderColor: ACCENT_SOFT,
  },
  userText: {
    color: '#e5e7eb',
  },
  assistantText: {
    color: '#e5e7eb',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#111827',
    backgroundColor: BG,
  },
  webFooter: {
    paddingBottom: 28,
  },
  attachRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  attachButton: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  attachButtonText: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  chipsRow: {
    marginBottom: 10,
  },
  attachmentChip: {
    marginRight: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attachmentChipText: {
    color: '#f9fafb',
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#020617',
    color: '#f9fafb',
    fontSize: 14,
    marginBottom: 10,
  },
  sendButton: {
    backgroundColor: ACCENT,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#4b5563',
  },
  sendText: {
    color: '#020617',
    fontWeight: '700',
  },
});
