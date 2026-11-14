import { api, ApiError } from './api';
import type { Connection } from './api';

export type ProductionExportItem = {
  id: string;
  production_id: string;
  created_at: string;
  relative_path: string;
  size_bytes: number;
  sha256: string;
  publishable: boolean;
};

export type CreateExportResult = {
  item: ProductionExportItem;
  created: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseExportItem(raw: unknown): ProductionExportItem {
  if (!isRecord(raw)) {
    throw new Error('Resposta de exportação inválida.');
  }
  const id = typeof raw.id === 'string' ? raw.id : '';
  const productionId = typeof raw.production_id === 'string' ? raw.production_id : '';
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : '';
  const relativePath = typeof raw.relative_path === 'string' ? raw.relative_path : '';
  const sizeBytes = typeof raw.size_bytes === 'number' && Number.isFinite(raw.size_bytes) ? raw.size_bytes : 0;
  const sha256 = typeof raw.sha256 === 'string' ? raw.sha256 : '';
  if (!id || !productionId || !sha256) {
    throw new Error('Metadados de exportação incompletos.');
  }
  return {
    id,
    production_id: productionId,
    created_at: createdAt,
    relative_path: relativePath,
    size_bytes: sizeBytes,
    sha256,
    publishable: raw.publishable === true,
  };
}

function assertLoopbackUrl(baseUrl: string, path: string): string {
  const parsedBase = new URL(baseUrl);
  const host = parsedBase.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('Operação recusada: apenas loopback local é permitido.');
  }
  const target = new URL(path, parsedBase.origin);
  if (target.origin !== parsedBase.origin) {
    throw new Error('Endereço externo não permitido.');
  }
  return target.toString();
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!value || /[/:\\]|\.\./.test(value)) {
    throw new Error(`${label} inválido.`);
  }
}

export function formatExportError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return error.message;
    }
    if (error.status === 401) {
      return `Sessão não autorizada (401): ${error.message}`;
    }
    if (error.status === 422) {
      return `Pedido de exportação inválido (422): ${error.message}`;
    }
    return `Erro ao exportar pacote (${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function listProductionExports(
  connection: Connection,
  productionId: string,
  signal?: AbortSignal
): Promise<ProductionExportItem[]> {
  assertSafeIdentifier(productionId, 'Identificador da produção');
  try {
    const response = await api<{ items?: unknown[] } | unknown[]>(
      connection,
      `/v1/productions/${encodeURIComponent(productionId)}/exports`,
      { signal }
    );
    const rawItems = Array.isArray(response)
      ? response
      : isRecord(response) && Array.isArray(response.items)
        ? response.items
        : [];
    return rawItems.map(parseExportItem);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function createProductionExport(
  connection: Connection,
  productionId: string,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<CreateExportResult> {
  assertSafeIdentifier(productionId, 'Identificador da produção');
  const url = assertLoopbackUrl(
    connection.baseUrl,
    `/v1/productions/${encodeURIComponent(productionId)}/export`
  );
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      'Idempotency-Key': idempotencyKey,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      detail?: unknown;
      message?: unknown;
    } | null;
    const detail =
      typeof body?.detail === 'string' && body.detail.trim()
        ? body.detail.trim()
        : typeof body?.message === 'string' && body.message.trim()
          ? body.message.trim()
          : `Não foi possível exportar o pacote (${response.status}).`;
    throw new ApiError(detail, response.status);
  }
  const raw = await response.json();
  return {
    item: parseExportItem(raw),
    created: response.status === 201,
  };
}

export async function downloadProductionExportZip(
  connection: Connection,
  productionId: string,
  exportId: string,
  signal?: AbortSignal
): Promise<Blob> {
  assertSafeIdentifier(productionId, 'Identificador da produção');
  assertSafeIdentifier(exportId, 'Identificador da exportação');
  const url = assertLoopbackUrl(
    connection.baseUrl,
    `/v1/productions/${encodeURIComponent(productionId)}/exports/${encodeURIComponent(exportId)}/file`
  );
  const response = await fetch(url, {
    method: 'GET',
    signal,
    headers: {
      Authorization: `Bearer ${connection.token}`,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail =
      typeof body?.detail === 'string' && body.detail.trim()
        ? body.detail.trim()
        : `Não foi possível baixar o pacote ZIP (${response.status}).`;
    throw new ApiError(detail, response.status);
  }
  return response.blob();
}
