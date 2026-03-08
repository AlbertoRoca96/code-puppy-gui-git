import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

export default function SettingsScreen() {
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState('https://code-puppy-api.fly.dev');

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backText}>&larr; Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Settings</Text>
      
      <View style={styles.section}>
        <Text style={styles.label}>API Endpoint</Text>
        <TextInput
          style={styles.input}
          value={apiUrl}
          onChangeText={setApiUrl}
          placeholder="https://code-puppy-api.fly.dev"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>About</Text>
        <Text style={styles.description}>
          Configure your Code Puppy mobile app settings here.
        </Text>
      </View>
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
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
  },
  description: {
    fontSize: 14,
    color: '#475569',
  },
});
