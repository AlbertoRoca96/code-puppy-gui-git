import React from 'react';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen 
        name="index" 
        options={{ title: "Code Puppy 🐶" }} 
      />
      <Stack.Screen 
        name="settings" 
        options={{ title: "Settings" }} 
      />
      <Stack.Screen 
        name="about" 
        options={{ title: "About" }} 
      />
    </Stack>
  );
}
