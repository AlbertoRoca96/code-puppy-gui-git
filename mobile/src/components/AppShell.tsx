import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const BG = '#050816';
const CARD_BG = '#0b1020';
const BORDER = '#111827';
const TEXT = '#f9fafb';
const MUTED = '#94a3b8';

export function AppShell({
  title,
  subtitle,
  children,
  onBack,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.shell}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={styles.backBtn}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            <View style={styles.content}>{children}</View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export const shellColors = {
  bg: BG,
  card: CARD_BG,
  border: BORDER,
  text: TEXT,
  muted: MUTED,
  accent: '#ff4ecf',
  accentSoft: '#1e293b',
  danger: '#dc2626',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  shell: {
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 860 : 680,
    alignSelf: 'center',
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  backText: {
    color: TEXT,
    fontWeight: '700',
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
  },
  title: {
    color: TEXT,
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 10,
    color: MUTED,
    fontSize: 16,
    lineHeight: 26,
  },
  content: {
    marginTop: 20,
    gap: 14,
  },
});
