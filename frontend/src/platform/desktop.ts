import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Connection } from '../services/api';

export const nativeDesktop = isTauri();

export async function connectDesktop(): Promise<Connection | null> {
  if (!nativeDesktop) return null;
  return invoke<Connection>('backend_connection');
}

export async function selectMedia(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ multiple: false, directory: false, filters: [
    { name: 'Áudio e vídeo', extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv', 'wav', 'mp3', 'ogg'] },
  ] });
  return typeof selected === 'string' ? selected : null;
}

export async function selectDirectory(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ multiple: false, directory: true });
  return typeof selected === 'string' ? selected : null;
}

export async function openLegacy(): Promise<void> {
  await invoke('open_legacy');
}
