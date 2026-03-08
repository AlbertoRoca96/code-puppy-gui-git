import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet 
} from 'react-native';
import { UseChat } from '@/src/hooks/useChat';

export default function ChatScreen() {
  const { messages, isLoading, sendMessage } = UseChat();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Code Puppy 🐶</Text>
        <Text style={styles.subtitle}>Your sassy coding assistant</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.welcomeText}>
          Send me a coding task and I'll help you out! 🐾
        </Text>
      </View>

      {/* Chat messages will be here */}
      <View style={styles.messageArea}>
        {messages.length === 0 ? (
          <Text style={styles.placeholder}>No messages yet. Start chatting!</Text>
        ) : (
          messages.map((msg) => (
            <Text key={msg.id}>
              {msg.role}: {msg.content}
            </Text>
          ))
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.inputPlaceholder}>Type your prompt here...</Text>
        <View style={styles.sendButton}>
          <Text style={styles.sendText}>Send 🚀</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    padding: 16,
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
    padding: 16,
  },
  placeholder: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
  },
  footer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 10,
  },
  inputPlaceholder: {
    fontSize: 14,
    color: '#cbd5e1',
    padding: 12,
    backgroundColor: '#fff',
  },
  sendButton: {
    backgroundColor: '#2563eb',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  sendText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
