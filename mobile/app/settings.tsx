import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppShell, shellColors } from '../src/components/AppShell';
import { getCurrentUser } from '../src/lib/api';
import { getCurrentSessionUser, signOut } from '../src/lib/auth';
import { API_BASE, SUPABASE_URL } from '../src/lib/config';

export default function SettingsScreen() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('Unknown');
  const [userId, setUserId] = useState<string>('Unknown');

  useEffect(() => {
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

  const handleSignOut = async () => {
    await signOut();
    router.replace('/auth' as any);
  };

  return (
    <AppShell
      title="Settings"
      subtitle="Account, backend, and environment details without the ugly admin-panel energy."
      onBack={() => router.back()}
    >
      <View style={styles.section}>
        <Text style={styles.label}>Account</Text>
        <Text style={styles.description}>Email: {email}</Text>
        <Text style={styles.description}>User ID: {userId}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Backend</Text>
        <Text style={styles.description}>API Base: {API_BASE}</Text>
        <Text style={styles.description}>Supabase: {SUPABASE_URL}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>About</Text>
        <Text style={styles.description}>
          Configure your Code Puppy app settings here.
        </Text>
      </View>

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
