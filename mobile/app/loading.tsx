import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

const BG = '#050816';
const TEXT = '#f8fafc';
const MUTED = '#94a3b8';
const ACCENT = '#ff4ecf';

export default function LoadingScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={styles.title}>Code Puppy</Text>
      <Text style={styles.subtitle}>
        Restoring your session. Hold your dramatic sigh.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  title: {
    color: TEXT,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: MUTED,
    fontSize: 15,
    textAlign: 'center',
  },
});
