import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { UseChat } from '../src/hooks/useChat';

export default function ChatScreen() {
  const { messages, isLoading, sendMessage } = UseChat();
  const [input, setInput] = useState('');

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed);
    setInput('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Puppy Chat</Text>
        <Text style={styles.subtitle}>Your sassy coding assistant</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.welcomeText}>
          Send me a coding task and I'll help you out! 🐾
        </Text>
      </View>

      <ScrollView
        style={styles.messageArea}
        contentContainerStyle={
          messages.length === 0 ? styles.emptyContainer : undefined
        }
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <Text style={styles.placeholder}>No messages yet. Start chatting!</Text>
        ) : (
          messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.messageBubble,
                msg.role === 'user'
                  ? styles.userBubble
                  : styles.assistantBubble,
              ]}
            >
              <Text
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
        {isLoading && (
          <Text style={styles.typingIndicator}>Puppy is thinking…</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TextInput
          style={styles.input}
          placeholder="Type your prompt here..."
          placeholderTextColor="#cbd5e1"
          value={input}
          onChangeText={setInput}
          editable={!isLoading}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!input.trim() || isLoading) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!input.trim() || isLoading}
        >
          <Text style={styles.sendText}>
            {isLoading ? 'Thinking…' : 'Send 🚀'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  content: {
    padding: 16,
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 16,
    color: '#475569',
    textAlign: 'center',
  },
  messageArea: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  placeholder: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 12,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563eb',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#e2e8f0',
  },
  userText: {
    color: '#fff',
  },
  assistantText: {
    color: '#1e293b',
  },
  typingIndicator: {
    marginTop: 8,
    fontSize: 13,
    color: '#94a3b8',
  },
  footer: {
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    fontSize: 14,
    marginBottom: 8,
  },
  sendButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#93c5fd',
  },
  sendText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
