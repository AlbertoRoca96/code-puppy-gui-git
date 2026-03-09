import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { AppShell, shellColors } from '../src/components/AppShell';

export default function AboutScreen() {
  const router = useRouter();

  return (
    <AppShell
      title="About Code Puppy 🐶"
      subtitle="Same product, same vibes, whether you're in the app or the browser. Finally."
      onBack={() => router.back()}
    >
      <View style={styles.content}>
        <Text style={styles.text}>
          Code Puppy is your sassy AI coding assistant that helps you complete tasks without bloated IDEs!
        </Text>
        
        <View style={styles.section}>
          <Text style={styles.heading}>Features:</Text>
          <Text style={styles.bullet}>• Chat-style conversation</Text>
          <Text style={styles.bullet}>• Multiple AI providers</Text>
          <Text style={styles.bullet}>• Clean, fun interface</Text>
          <Text style={styles.bullet}>• FastAPI backend</Text>
          <Text style={styles.bullet}>• No vendor lock-in</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Version:</Text>
          <Text style={styles.text}>1.0.0</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Built with:</Text>
          <Text style={styles.text}>
            React Native + Expo + FastAPI + Python 🐍
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Deployed 24/7:</Text>
          <Text style={styles.text}>
            GitHub Pages: albertoroca96.github.io/code-puppy-gui-git
          </Text>
          <Text style={styles.text}>
            API: code-puppy-api.fly.dev
          </Text>
          <Text style={styles.text}>
            Mobile: iOS App (TestFlight)
          </Text>
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 20,
  },
  text: {
    fontSize: 16,
    color: shellColors.text,
    lineHeight: 24,
  },
  section: {
    marginTop: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: 'bold',
    color: shellColors.muted,
  },
  bullet: {
    fontSize: 16,
    color: shellColors.text,
    paddingLeft: 8,
    lineHeight: 24,
  },
});
