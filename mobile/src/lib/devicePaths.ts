import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

export interface DevicePathDebugInfo {
  originalUri: string | null | undefined;
  normalizedUri: string | null;
  platform: string;
  scheme: string;
  notes: string[];
}

function safeExtFromUri(uri: string): string {
  const clean = (uri || '').split('?')[0];
  const last = clean.split('/').pop() || '';
  const ext = (last.includes('.') ? last.split('.').pop() : '') || '';
  const normalized = ext.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized || 'bin';
}

export async function normalizeDeviceFileUri(
  uri: string | null | undefined
): Promise<DevicePathDebugInfo> {
  const notes: string[] = [];
  if (!uri) {
    return {
      originalUri: uri,
      normalizedUri: null,
      platform: Platform.OS,
      scheme: 'unknown',
      notes: ['Missing URI from picker result.'],
    };
  }

  const schemeMatch = uri.match(/^([a-zA-Z0-9+.-]+):\/\//);
  const scheme = schemeMatch?.[1] || (uri.startsWith('file:') ? 'file' : 'unknown');
  let normalizedUri = uri;

  if (Platform.OS === 'ios' && uri.startsWith('file://')) {
    notes.push('iOS file URI preserved as file:// for React Native upload fetch.');
  }

  if (Platform.OS === 'android' && uri.startsWith('content://')) {
    notes.push('Android content:// URI detected; copying to cache for stable upload.');
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) {
      notes.push('Expo cache directory unavailable; falling back to original content URI.');
    } else {
      const ext = safeExtFromUri(uri);
      const dest = `${cacheDir}code-puppy-upload-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}.${ext}`;
      try {
        await FileSystem.copyAsync({ from: uri, to: dest });
        normalizedUri = dest;
        notes.push(`Copied Android content URI to cache: ${dest}`);
      } catch (error) {
        notes.push(`Failed to copy content URI to cache: ${String(error)}`);
      }
    }
  }

  if (Platform.OS === 'android' && uri.startsWith('file://')) {
    notes.push('Android file:// URI preserved for upload.');
  }

  if (uri.startsWith('ph://')) {
    notes.push('iOS Photos ph:// URI may require conversion if returned by a different picker flow.');
  }

  return {
    originalUri: uri,
    normalizedUri,
    platform: Platform.OS,
    scheme,
    notes,
  };
}
