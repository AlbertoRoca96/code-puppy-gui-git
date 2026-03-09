import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
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
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>&larr; Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Settings</Text>

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
          Configure your Code Puppy mobile app settings here.
        </Text>
      </View>

      <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8fafc',
  },
  backBtn: {
    marginBottom: 16,
  },
  backText: {
    fontSize: 16,
    color: '#2563eb',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
    color: '#1e293b',
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#64748b',
  },
  description: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 6,
  },
  signOutBtn: {
    marginTop: 12,
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: {
    color: '#fff',
    fontWeight: '800',
  },
});
