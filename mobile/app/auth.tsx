import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { signInWithPassword, signUpWithPassword } from '../src/lib/auth';

const BG = '#050816';
const CARD = '#0b1020';
const ACCENT = '#ff4ecf';
const TEXT = '#f8fafc';
const MUTED = '#94a3b8';
const ERROR = '#fecaca';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Email and password are required. Revolutionary stuff, I know.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signInWithPassword(cleanEmail, password);
      } else {
        const session = await signUpWithPassword(cleanEmail, password);
        if (!session.access_token) {
          throw new Error('Signup succeeded, but email confirmation may still be required.');
        }
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Welcome to Code Puppy</Text>
          <Text style={styles.subtitle}>
            Sign in so your chats and files actually belong to you. Wild concept.
          </Text>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggle, mode === 'signin' && styles.toggleActive]}
              onPress={() => setMode('signin')}
            >
              <Text style={styles.toggleText}>Sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggle, mode === 'signup' && styles.toggleActive]}
              onPress={() => setMode('signup')}
            >
              <Text style={styles.toggleText}>Sign up</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={MUTED}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={MUTED}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: BG },
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: CARD, borderRadius: 20, padding: 20, gap: 12 },
  title: { color: TEXT, fontSize: 28, fontWeight: '800' },
  subtitle: { color: MUTED, fontSize: 14, lineHeight: 20 },
  toggleRow: { flexDirection: 'row', gap: 10, marginVertical: 6 },
  toggle: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#111827' },
  toggleActive: { backgroundColor: ACCENT },
  toggleText: { color: TEXT, textAlign: 'center', fontWeight: '700' },
  input: { backgroundColor: '#111827', color: TEXT, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  error: { color: ERROR },
  button: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
  buttonText: { color: TEXT, textAlign: 'center', fontWeight: '800' },
});
