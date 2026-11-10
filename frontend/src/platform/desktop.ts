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

export const transcriptionExtensions = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma',
  'mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v'];

export async function selectMediaFiles(): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ multiple: true, directory: false, title: 'Adicionar à fila (até 20 arquivos)', filters: [
    { name: 'Áudio e vídeo', extensions: transcriptionExtensions }, { name: 'Todos os arquivos', extensions: ['*'] },
  ] });
  return Array.isArray(selected) ? selected : typeof selected === 'string' ? [selected] : [];
}

export async function selectSavePath(suggested: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({ title: 'Salvar transcrição', defaultPath: suggested, filters: [{ name: 'Texto', extensions: ['txt'] }] });
}

/** Arquivos soltos na janela desktop; o WebView não fornece caminhos ao HTML5 drag and drop. */
export async function onFileDrop(handler: (event: { hovering: boolean; paths: string[] }) => void): Promise<() => void> {
  if (!nativeDesktop) return () => undefined;
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'drop') handler({ hovering: false, paths: payload.paths });
    else handler({ hovering: payload.type !== 'leave', paths: [] });
  });
}
