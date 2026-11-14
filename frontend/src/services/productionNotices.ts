import { useEffect, useState } from 'react';
import type { Connection } from './api';
import { getProduction } from './production';
import type { ProductionRecord } from './production';

export type ProductionNoticeKind = 'succeeded' | 'failed' | 'interrupted';

export type ProductionNotice = {
  id: string;
  productionId: string;
  kind: ProductionNoticeKind;
  badge: string;
  message: string;
};

type TrackerSnapshot = {
  activeIds: string[];
  activeCount: number;
  notice: ProductionNotice | null;
};

const ACTIVE_STATUSES = new Set<string>(['queued', 'running', 'cancel_requested']);
const DEFAULT_POLL_INTERVAL_MS = 5000;
const MAX_BACKOFF_MS = 30000;

const activeProductions = new Map<string, ProductionRecord>();
let currentNotice: ProductionNotice | null = null;
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function buildTerminalNotice(record: ProductionRecord): ProductionNotice | null {
  const shortId = record.id.slice(0, 8);
  const detail = typeof record.error === 'string' && record.error.trim() ? record.error.trim() : null;

  if (record.status === 'succeeded') {
    return {
      id: `${record.id}:succeeded:${record.updated_at}`,
      productionId: record.id,
      kind: 'succeeded',
      badge: 'PRONTA PARA REVISÃO',
      message: `Produção ${shortId} concluída e pronta para revisão.`,
    };
  }
  if (record.status === 'failed' || record.status === 'blocked') {
    const label = record.status === 'blocked' ? 'bloqueada' : 'falhou';
    return {
      id: `${record.id}:${record.status}:${record.updated_at}`,
      productionId: record.id,
      kind: 'failed',
      badge: record.status === 'blocked' ? 'PRODUÇÃO BLOQUEADA' : 'FALHA NA PRODUÇÃO',
      message: detail
        ? `Produção ${shortId} ${label}: ${detail}`
        : `Produção ${shortId} ${label}.`,
    };
  }
  if (record.status === 'interrupted') {
    return {
      id: `${record.id}:interrupted:${record.updated_at}`,
      productionId: record.id,
      kind: 'interrupted',
      badge: 'PRODUÇÃO INTERROMPIDA',
      message: detail
        ? `Produção ${shortId} interrompida: ${detail}`
        : `Produção ${shortId} interrompida.`,
    };
  }
  return null;
}

/**
 * Registra uma produção iniciada nesta sessão quando estiver em estado não terminal
 * (queued, running ou cancel_requested).
 */
export function observeProductionCreated(record: ProductionRecord): void {
  if (!record || typeof record.id !== 'string') return;
  if (ACTIVE_STATUSES.has(record.status)) {
    activeProductions.set(record.id, record);
    emitChange();
  }
}

/**
 * Atualiza o estado de uma produção iniciada nesta sessão e emite aviso discreto
 * quando ela atinge estado terminal (succeeded, failed, blocked ou interrupted).
 */
export function observeProductionRecord(record: ProductionRecord): void {
  if (!record || typeof record.id !== 'string') return;
  if (!activeProductions.has(record.id)) return;

  if (ACTIVE_STATUSES.has(record.status)) {
    const prev = activeProductions.get(record.id);
    activeProductions.set(record.id, record);
    if (!prev || prev.status !== record.status || prev.stage !== record.stage) {
      emitChange();
    }
    return;
  }

  activeProductions.delete(record.id);
  const notice = buildTerminalNotice(record);
  if (notice) {
    currentNotice = notice;
  }
  emitChange();
}

export function observeProductionList(records: ProductionRecord[]): void {
  for (const record of records) {
    observeProductionRecord(record);
  }
}

export function dismissProductionNotice(): void {
  if (currentNotice !== null) {
    currentNotice = null;
    emitChange();
  }
}

export function getProductionTrackerSnapshot(): TrackerSnapshot {
  return {
    activeIds: Array.from(activeProductions.keys()),
    activeCount: activeProductions.size,
    notice: currentNotice,
  };
}

export function getProductionPollIntervalMs(): number {
  if (typeof window !== 'undefined') {
    const custom = (window as { __HORUS_PRODUCTION_POLL_MS__?: unknown }).__HORUS_PRODUCTION_POLL_MS__;
    if (typeof custom === 'number' && Number.isFinite(custom) && custom >= 50) {
      return custom;
    }
  }
  return DEFAULT_POLL_INTERVAL_MS;
}

export function useProductionObserver(connection: Connection | null): TrackerSnapshot & {
  dismissNotice: () => void;
} {
  const [snapshot, setSnapshot] = useState<TrackerSnapshot>(() => getProductionTrackerSnapshot());

  useEffect(() => {
    const sync = () => setSnapshot(getProductionTrackerSnapshot());
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const activeKey = snapshot.activeIds.join(',');

  useEffect(() => {
    if (!connection || !activeKey) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let timer: number | undefined;
    let consecutiveErrors = 0;

    const scheduleNext = () => {
      if (cancelled) return;
      const currentIds = getProductionTrackerSnapshot().activeIds;
      if (currentIds.length === 0) return;
      const base = getProductionPollIntervalMs();
      const delay = Math.min(base * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
      timer = window.setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async () => {
      if (cancelled) return;
      const currentIds = getProductionTrackerSnapshot().activeIds;
      if (currentIds.length === 0) return;
      let hadError = false;
      for (const id of currentIds) {
        try {
          await getProduction(connection, id, controller.signal);
        } catch {
          if (cancelled || controller.signal.aborted) return;
          hadError = true;
        }
      }
      if (cancelled) return;
      consecutiveErrors = hadError ? consecutiveErrors + 1 : 0;
      scheduleNext();
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller.abort();
    };
  }, [connection, activeKey]);

  return {
    ...snapshot,
    dismissNotice: dismissProductionNotice,
  };
}
