import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { AppShell, shellColors } from '../src/components/AppShell';
import { getCurrentUser } from '../src/lib/api';
import { getCurrentSessionUser, signOut } from '../src/lib/auth';
import { DEFAULT_API_BASE, SUPABASE_URL } from '../src/lib/config';
import { loadPreferences, savePreferences } from '../src/lib/preferences';

export default function SettingsScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('Unknown');
  const [userId, setUserId] = useState<string>('Unknown');
  const [apiBaseOverride, setApiBaseOverride] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    loadPreferences()
      .then((prefs) => {
        setApiBaseOverride(prefs.apiBaseOverride || '');
        setWebSearchEnabled(Boolean(prefs.webSearchEnabled));
        setStreamingEnabled(prefs.streamingEnabled ?? true);
      })
      .catch(() => undefined);

    getCurrentSessionUser()
      .then((user) => {
        if (user?.email) setEmail(user.email);
        if (user?.id) setUserId(user.id);
      })
      .catch(() => undefined);

    getCurrentUser()
      .then((user) => {
        if (user.email) setEmail(user.email);
        if (user.id) setUserId(user.id);
      })
      .catch(() => undefined);
  }, []);

  const handleSave = async () => {
    await savePreferences({
      apiBaseOverride: apiBaseOverride.trim(),
      webSearchEnabled,
      streamingEnabled,
    });
    setSavedMessage('Saved. Fancy that.');
    setTimeout(() => setSavedMessage(null), 1800);
  };

  const handleResetApiBase = () => {
    setApiBaseOverride('');
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/auth' as any);
  };

  return (
    <AppShell
      title="Settings"
      subtitle="Account, backend, and chat behavior controls without the ugly admin-panel energy."
      onBack={() => router.back()}
    >
      <View style={styles.section}>
        <Text style={styles.label}>Account</Text>
        <Text style={styles.description}>Email: {email}</Text>
        <Text style={styles.description}>User ID: {userId}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Backend</Text>
        <Text style={styles.description}>Default API Base: {DEFAULT_API_BASE}</Text>
        <TextInput
          style={styles.input}
          value={apiBaseOverride}
          onChangeText={setApiBaseOverride}
          placeholder="Optional API base override"
          placeholderTextColor={shellColors.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleResetApiBase}>
          <Text style={styles.secondaryBtnText}>Reset API base override</Text>
        </TouchableOpacity>
        <Text style={styles.description}>Supabase: {SUPABASE_URL}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Chat defaults</Text>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Web search</Text>
            <Text style={styles.description}>
              Allow search augmentation for future chats.
            </Text>
          </View>
          <Switch value={webSearchEnabled} onValueChange={setWebSearchEnabled} />
        </View>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Streaming responses</Text>
            <Text style={styles.description}>
              Show assistant output token-by-token when available.
            </Text>
          </View>
          <Switch value={streamingEnabled} onValueChange={setStreamingEnabled} />
        </View>
      </View>

      <TouchableOpacity onPress={handleSave} style={styles.primaryBtn}>
        <Text style={styles.primaryBtnText}>Save settings</Text>
      </TouchableOpacity>
      {savedMessage ? <Text style={styles.savedMessage}>{savedMessage}</Text> : null}

      <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    color: shellColors.muted,
  },
  description: {
    fontSize: 14,
    color: shellColors.text,
    marginBottom: 6,
    lineHeight: 22,
  },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#020617',
    color: shellColors.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#111827',
  },
  secondaryBtnText: {
    color: shellColors.text,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  toggleCopy: {
    flex: 1,
  },
  toggleTitle: {
    color: shellColors.text,
    fontWeight: '800',
    marginBottom: 4,
  },
  primaryBtn: {
    backgroundColor: shellColors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#0b1120',
    fontWeight: '900',
  },
  savedMessage: {
    color: '#bfdbfe',
    marginTop: 10,
  },
  signOutBtn: {
    marginTop: 12,
    backgroundColor: shellColors.danger,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: {
    color: '#fff',
    fontWeight: '800',
  },
});
