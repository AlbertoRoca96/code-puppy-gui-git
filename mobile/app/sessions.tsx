import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { listSessions, SessionSummary } from '../src/lib/sessions';

const BG = '#050816';
const CARD_BG = '#0b1020';
const ACCENT = '#ff4ecf';

export default function SessionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const currentSessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await listSessions();
      setSessions(items);
    } catch (error) {
      console.error('Failed to load sessions', error);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredSessions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return sessions;
    return sessions.filter((session) =>
      [session.title, session.sessionId]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term))
    );
  }, [query, sessions]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Chats</Text>
          <TouchableOpacity style={styles.newButton} onPress={() => router.push('/')}>
            <Text style={styles.newButtonText}>New chat</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats"
          placeholderTextColor="#6b7280"
        />

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : (
          <FlatList
            data={filteredSessions}
            keyExtractor={(item) => item.sessionId}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isActive = item.sessionId === currentSessionId;
              return (
                <TouchableOpacity
                  style={[styles.sessionCard, isActive && styles.sessionCardActive]}
                  onPress={() => router.push(`/?sessionId=${encodeURIComponent(item.sessionId)}`)}
                >
                  <Text style={styles.sessionTitle}>{item.title || 'New chat'}</Text>
                  <Text style={styles.sessionMeta}>
                    {item.messageCount} msgs • {new Date(item.updatedAt * 1000).toLocaleString()}
                  </Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.centered}>
                <Text style={styles.emptyText}>
                  {query.trim()
                    ? 'No chats match your search.'
                    : 'No chats yet. Start one and I’ll hoard it forever.'}
                </Text>
              </View>
            }
          />
        )}
      </View>
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
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f9fafb',
  },
  newButton: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  newButtonText: {
    color: '#0b1120',
    fontWeight: '700',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#020617',
    color: '#f9fafb',
    fontSize: 14,
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 24,
  },
  sessionCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: '#111827',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  sessionCardActive: {
    borderColor: ACCENT,
    shadowColor: ACCENT,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  sessionTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '700',
  },
  sessionMeta: {
    marginTop: 6,
    color: '#9ca3af',
    fontSize: 13,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#9ca3af',
    textAlign: 'center',
    fontSize: 15,
  },
});
