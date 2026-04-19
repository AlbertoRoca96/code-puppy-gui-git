import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  loadLocalSessionIndex,
  loadLocalSessionSnapshot,
  LocalSessionIndexEntry,
} from '../src/lib/localSessions';

const BG = '#020617';
const CARD_BG = '#020617';
const BORDER = '#1f2937';
const TEXT = '#e5e7eb';
const MUTED = '#9ca3af';
const ACCENT = '#7c3aed';

export default function DebugStorageScreen() {
  const router = useRouter();
  const [index, setIndex] = useState<LocalSessionIndexEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJson, setSelectedJson] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const entries = await loadLocalSessionIndex();
        setIndex(entries);
      } catch (error) {
        console.warn('[debug-storage] failed to load local index', error);
      }
    })();
  }, []);

  const selectSession = async (sessionId: string) => {
    setSelectedId(sessionId);
    setSelectedJson('Loading snapshot…');
    try {
      const snapshot = await loadLocalSessionSnapshot(sessionId);
      if (!snapshot) {
        setSelectedJson('No local snapshot found for this session.');
        return;
      }
      setSelectedJson(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      setSelectedJson(String(error));
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Storage debug</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.container}>
        <View style={styles.leftPane}>
          <Text style={styles.sectionTitle}>Local session index</Text>
          <FlatList
            data={index}
            keyExtractor={(item) => item.sessionId}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isActive = item.sessionId === selectedId;
              return (
                <TouchableOpacity
                  style={[styles.row, isActive && styles.rowActive]}
                  onPress={() => selectSession(item.sessionId)}
                >
                  <Text style={styles.rowTitle}>{item.title || 'New chat'}</Text>
                  <Text style={styles.rowMeta}>
                    {item.messageCount} msgs •{' '}
                    {new Date(item.updatedAt * 1000).toLocaleString()}
                  </Text>
                  <Text style={styles.rowId}>{item.sessionId}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No local sessions cached yet.</Text>
              </View>
            }
          />
        </View>

        <View style={styles.rightPane}>
          <Text style={styles.sectionTitle}>Snapshot JSON</Text>
          <ScrollView
            style={styles.jsonScroll}
            contentContainerStyle={styles.jsonContent}
          >
            <Text style={styles.jsonText} selectable>
              {selectedJson || 'Tap a session to inspect its local snapshot.'}
            </Text>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backText: {
    color: ACCENT,
    fontWeight: '700',
  },
  title: {
    color: TEXT,
    fontSize: 18,
    fontWeight: '800',
  },
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  leftPane: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    padding: 12,
  },
  rightPane: {
    flex: 1,
    padding: 12,
  },
  sectionTitle: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  rowActive: {
    borderColor: ACCENT,
  },
  rowTitle: {
    color: TEXT,
    fontWeight: '700',
  },
  rowMeta: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  rowId: {
    color: MUTED,
    fontSize: 10,
    marginTop: 4,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: MUTED,
    fontSize: 13,
  },
  jsonScroll: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#020617',
  },
  jsonContent: {
    padding: 10,
  },
  jsonText: {
    color: '#e5e7eb',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 11,
  },
});
