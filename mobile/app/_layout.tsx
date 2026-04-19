import React from 'react';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="auth" options={{ title: 'Sign in' }} />
      <Stack.Screen name="auth/callback" options={{ title: 'Auth callback' }} />
      <Stack.Screen name="loading" options={{ title: 'Loading' }} />
      <Stack.Screen name="index" options={{ title: 'Code Puppy 🐶' }} />
      <Stack.Screen name="sessions" options={{ title: 'Chats' }} />
      <Stack.Screen name="debug-storage" options={{ title: 'Storage debug' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
    </Stack>
  );
}
