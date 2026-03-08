import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { loadStoredSession } from '../src/lib/auth';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    loadStoredSession()
      .then((session) => setAuthenticated(Boolean(session?.access_token)))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return null;
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {!authenticated ? (
        <Stack.Screen
          name="auth"
          options={{ title: 'Sign in' }}
        />
      ) : null}
      <Stack.Screen
        name="index"
        options={{ title: 'Code Puppy 🐶' }}
      />
      <Stack.Screen
        name="sessions"
        options={{ title: 'Chats' }}
      />
      <Stack.Screen
        name="debug-storage"
        options={{ title: 'Storage debug' }}
      />
      <Stack.Screen
        name="settings"
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="about"
        options={{ title: 'About' }}
      />
    </Stack>
  );
}
