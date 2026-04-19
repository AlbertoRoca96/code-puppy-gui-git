import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export async function getPersistentItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return window.localStorage.getItem(key);
    }
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setPersistentItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      window.localStorage.setItem(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  } catch {
    // ignore storage failures
  }
}

export async function deletePersistentItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      window.localStorage.removeItem(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}
