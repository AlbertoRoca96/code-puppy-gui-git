import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { completeAuthFromUrl } from '../../src/lib/auth';

const BG = '#050816';
const TEXT = '#f8fafc';
const MUTED = '#94a3b8';
const ACCENT = '#ff4ecf';

export default function AuthCallbackScreen() {
  const [message, setMessage] = useState('Completing auth…');

  useEffect(() => {
    const run = async () => {
      let url: string | null = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        url = window.location.href;
      } else {
        url = await Linking.getInitialURL();
      }

      if (!url) {
        setMessage('No auth callback URL was found. Very cool, very helpful.');
        return;
      }

      const result = await completeAuthFromUrl(url);
      setMessage(result.message);
      setTimeout(() => {
        router.replace((result.success ? '/' : '/auth') as any);
      }, 900);
    };

    run().catch((error) => {
      setMessage(error instanceof Error ? error.message : String(error));
      setTimeout(() => router.replace('/auth' as any), 1200);
    });
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={styles.title}>Code Puppy</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    color: TEXT,
    fontSize: 28,
    fontWeight: '800',
  },
  message: {
    color: MUTED,
    fontSize: 15,
    textAlign: 'center',
    maxWidth: 420,
  },
});
