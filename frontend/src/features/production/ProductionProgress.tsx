import { useEffect, useState } from 'react';
import type { JobEvent } from '../../services/api';

/** Etapa interna -> rótulo em português (inclui `align`, que não faz parte da trilha de 7 etapas). */
export const STAGE_TEXT: Record<string, string> = {
  prepare: 'Preparação',
  narration: 'Narração',
  scenes: 'Cenas',
  align: 'Alinhando fala',
  subtitles: 'Legendas',
  render: 'Render',
  quality: 'Qualidade (QC)',
  review: 'Revisão',
};

export const STAGE_HINTS: Record<string, string> = {
  prepare: 'Preparando roteiro e conferindo pré-condições locais.',
  narration: 'Gerando o áudio da narração localmente.',
  scenes: 'Montando as cenas visuais de cada seção.',
  align: 'Alinhando o texto narrado com os tempos reais do áudio.',
  subtitles: 'Gerando e sincronizando as legendas.',
  render: 'Renderizando o vídeo MP4 na fábrica local.',
  quality: 'Executando as verificações automáticas de qualidade (QC).',
  review: 'Aguardando sua revisão humana e aprovação.',
};

const FAILURE_CODE_ACTIONS: Record<string, string> = {
  narration_timeout:
    'A síntese da narração excedeu o tempo limite. Tente um trecho mais curto ou verifique o motor de voz local em Ajustes → Narração antes de iniciar uma nova produção.',
  narration_truncated_wav:
    'O áudio gerado pela narração ficou incompleto ou corrompido. Teste a voz em Ajustes → Narração e inicie uma nova produção.',
  narration_unavailable:
    'O provedor local de narração está indisponível. Confira a configuração da voz em Ajustes → Narração e tente novamente.',
  kokoro_synthesis_failed:
    'A síntese local do Kokoro falhou. Confira se o modelo e o ambiente do Kokoro estão íntegros em Ajustes → Narração ou escolha outra voz local.',
  kokoro_timeout:
    'A síntese local do Kokoro excedeu o tempo limite. Tente novamente ou escolha outra voz local em Ajustes → Narração.',
  local_narration_failed:
    'A narração local falhou. Verifique a voz selecionada em Ajustes → Narração e o diagnóstico técnico abaixo antes de tentar novamente.',
  local_tool_failed:
    'Uma ferramenta local (como FFmpeg ou utilitário da fábrica) retornou erro. Verifique o código de saída e o diagnóstico técnico abaixo e tente novamente.',
  render_failed:
    'A renderização do vídeo falhou na fábrica local. Confira o diagnóstico técnico abaixo (Remotion/FFmpeg) para corrigir a causa e inicie uma nova produção.',
  render_dependencies_missing:
    'Faltam dependências locais para renderizar o vídeo (FFmpeg, Remotion, browser ou pasta da fábrica). Instale ou configure o ambiente antes de tentar novamente.',
  production_interrupted:
    'A produção foi interrompida antes de concluir (por reinício do backend ou encerramento do processo). Revise os artefatos e o diagnóstico técnico abaixo e inicie uma nova produção.',
  production_timeout:
    'A produção excedeu o tempo limite de execução. Verifique o diagnóstico técnico abaixo e tente novamente.',
  production_precondition_failed:
    'Uma pré-condição local não foi atendida antes de iniciar a execução. Confira a mensagem acima e o ambiente local antes de tentar novamente.',
  production_worker_failed:
    'O processo executor da produção encerrou inesperadamente. Confira o diagnóstico técnico abaixo e inicie uma nova produção.',
  production_stage_failed:
    'Uma etapa da produção falhou. Confira a etapa e o diagnóstico técnico abaixo antes de iniciar uma nova produção.',
  local_pilot_blocked:
    'A execução em Piloto local foi bloqueada por uma restrição ou dependência local. Confira a mensagem acima e os ajustes do ambiente.',
  local_pilot_unavailable:
    'O modo Piloto local está indisponível no momento. Verifique as dependências locais ou utilize o modo Demo local/Simulado.',
};

export function suggestFailureAction(
  stage: string,
  errorMessage?: string | null,
  failureCode?: string | null
): string {
  if (failureCode && FAILURE_CODE_ACTIONS[failureCode]) {
    return FAILURE_CODE_ACTIONS[failureCode];
  }
  const msg = (errorMessage ?? '').toLowerCase();
  if (msg.includes('ffmpeg') || msg.includes('libass')) {
    return 'Verifique o executável do FFmpeg com suporte a libass em Ajustes ou na variável HORUS_FFMPEG e tente uma nova produção.';
  }
  if (msg.includes('fabrica_home') || msg.includes('horus_pilot_factory') || msg.includes('remotion') || msg.includes('browser')) {
    return 'Confirme a pasta da fábrica local (FABRICA_HOME / HORUS_PILOT_FACTORY) e as dependências do Remotion/browser antes de tentar novamente.';
  }
  if (msg.includes('kokoro') || msg.includes('piper') || msg.includes('sapi') || msg.includes('voz') || msg.includes('narration')) {
    return 'Confira a disponibilidade da voz em Ajustes → Narração ou escolha outra voz local instalada para iniciar uma nova produção.';
  }
  if (msg.includes('whisper') || msg.includes('alignment') || msg.includes('alinhamento')) {
    return 'Verifique o modelo local de alinhamento (HORUS_ALIGNMENT_MODEL) e inicie uma nova produção.';
  }
  switch (stage) {
    case 'narration':
      return 'Confira a voz selecionada em Ajustes → Narração, verifique os logs do job abaixo e inicie uma nova produção.';
    case 'align':
    case 'subtitles':
      return 'Confira os logs do job abaixo para detalhes do alinhamento/legendas e tente iniciar uma nova produção.';
    case 'render':
      return 'Confira os logs do job abaixo (fábrica/Remotion/FFmpeg) e tente iniciar uma nova produção.';
    case 'quality':
      return 'Verifique os logs do job abaixo para identificar a falha de QC antes de gerar novamente.';
    default:
      return 'Confira os logs reais do job abaixo para identificar a causa, ajuste o necessário e inicie uma nova produção.';
  }
}

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
}

const STATE_TEXT: Record<string, string> = {
  queued: 'na fila',
  running: 'em execução',
  succeeded: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
  interrupted: 'interrompido',
  blocked: 'bloqueado',
};

/** Traduz um evento do job mantendo o valor técnico entre parênteses para auditoria. */
export function describeJobEvent(event: Pick<JobEvent, 'kind' | 'message'>): string {
  if (event.kind === 'stage' && STAGE_TEXT[event.message]) {
    return `etapa: ${STAGE_TEXT[event.message]} (stage: ${event.message})`;
  }
  if (event.kind === 'state' && STATE_TEXT[event.message]) {
    return `estado: ${STATE_TEXT[event.message]} (${event.message})`;
  }
  return `${event.kind === 'state' ? 'estado' : event.kind}: ${event.message}`;
}

function parse(iso: string): number | null {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Progresso das esperas longas: etapa atual, tempo decorrido e última atualização do job.
 * Sem porcentagem: o backend não informa progresso mensurável dentro de cada etapa.
 */
export default function ProductionProgress({
  stage,
  status,
  createdAt,
  updatedAt,
  lastEvent,
  terminal,
  showNarrationHint,
}: {
  stage: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastEvent: JobEvent | null;
  terminal: boolean;
  showNarrationHint: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [terminal]);

  const start = parse(createdAt);
  const end = terminal ? parse(updatedAt) : now;
  const elapsed = start !== null && end !== null ? formatElapsed((end - start) / 1000) : null;
  const sinceUpdate = (() => {
    const updated = parse(updatedAt);
    return !terminal && updated !== null ? formatElapsed((now - updated) / 1000) : null;
  })();

  return (
    <div className="fact-item" role="status" aria-live="polite" aria-label="Progresso da execução">
      <span className="eyebrow">{terminal ? 'RESUMO DA EXECUÇÃO' : 'PROGRESSO DA EXECUÇÃO'}</span>
      <div className="info-grid">
        <div className="info-block">
          <span className="eyebrow">ETAPA ATUAL</span>
          <span>{STAGE_TEXT[stage] ?? stage}</span>
          {!terminal && STAGE_HINTS[stage] && (
            <small className="muted">{STAGE_HINTS[stage]}</small>
          )}
        </div>
        <div className="info-block">
          <span className="eyebrow">{terminal ? 'DURAÇÃO TOTAL' : 'TEMPO DECORRIDO'}</span>
          <span>{elapsed ?? '—'}</span>
        </div>
        <div className="info-block">
          <span className="eyebrow">ÚLTIMA ATUALIZAÇÃO DO JOB</span>
          <span>
            {lastEvent ? describeJobEvent(lastEvent) : `estado ${status}`}
            {sinceUpdate ? ` · registro de estado há ${sinceUpdate}` : ''}
          </span>
        </div>
      </div>
      {!terminal && (
        <small className="muted">
          O backend não informa porcentagem dentro de cada etapa: o tempo decorrido é medido desde o
          disparo e uma etapa pode ficar parada por mais de 1 minuto sem indicar travamento.
          {showNarrationHint &&
            ' A narração local (ex.: Kokoro) pode levar mais de 1 minuto só na primeira seção.'}
        </small>
      )}
    </div>
  );
}
