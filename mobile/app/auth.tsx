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
import {
  sendPasswordResetEmail,
  signInWithPassword,
  signUpWithPassword,
  toFriendlyAuthError,
} from '../src/lib/auth';

const BG = '#050816';
const CARD = '#0b1020';
const ACCENT = '#ff4ecf';
const TEXT = '#f8fafc';
const MUTED = '#94a3b8';
const ERROR = '#fecaca';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Email and password are required. Revolutionary stuff, I know.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        await signInWithPassword(cleanEmail, password);
        router.replace('/');
        return;
      }
      if (mode === 'reset') {
        await sendPasswordResetEmail(cleanEmail);
        setNotice('Password reset email sent. Check your inbox like a responsible adult.');
        return;
      }

      const result = await signUpWithPassword(cleanEmail, password);
      if (result.requiresEmailConfirmation) {
        setNotice(
          result.message ||
            'Account created. Confirm your email, then come back and sign in.'
        );
        setMode('signin');
        return;
      }
      router.replace('/');
    } catch (err) {
      setError(toFriendlyAuthError(err));
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
              onPress={() => {
                setMode('signin');
                setError(null);
                setNotice(null);
              }}
            >
              <Text style={styles.toggleText}>Sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggle, mode === 'signup' && styles.toggleActive]}
              onPress={() => {
                setMode('signup');
                setError(null);
                setNotice(null);
              }}
            >
              <Text style={styles.toggleText}>Sign up</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => {
              setMode('reset');
              setError(null);
              setNotice(null);
            }}
          >
            <Text style={styles.linkText}>Forgot password?</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={MUTED}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          {mode !== 'reset' ? (
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          ) : null}

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={busy}>
            <Text style={styles.buttonText}>
              {busy
                ? 'Working...'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset email'}
            </Text>
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
  linkText: { color: ACCENT, fontWeight: '700' },
  notice: { color: '#bfdbfe', lineHeight: 20 },
  error: { color: ERROR, lineHeight: 20 },
  button: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 14, marginTop: 8 },
  buttonText: { color: TEXT, textAlign: 'center', fontWeight: '800' },
});
