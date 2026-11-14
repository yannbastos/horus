import { getWorkflows } from './api';
import type { Connection } from './api';
import { getDefaultVoice } from './narration';
import { getScriptProductions } from './production';
import type { ProductionRecord } from './production';
import { getWorkflowScripts } from './scripts';
import type { ScriptRecord } from './scripts';

export type GuideStepId =
  | 'voice'
  | 'write_script'
  | 'approve_script'
  | 'produce_final'
  | 'review_approve';

export type GuideStepStatus = 'done' | 'in_progress' | 'pending' | 'unknown';

export type GuideTarget = 'settings' | 'production';

export type GuideStep = {
  id: GuideStepId;
  title: string;
  detail: string;
  status: GuideStepStatus;
  target: GuideTarget;
  actionLabel: string;
};

export type FirstVideoGuideState = {
  steps: GuideStep[];
  completedCount: number;
  isCompleted: boolean;
};

export const GUIDE_STATUS_LABEL: Record<GuideStepStatus, string> = {
  done: 'Feito',
  in_progress: 'Em andamento',
  pending: 'Pendente',
  unknown: 'não foi possível verificar',
};

const RUNNING_PRODUCTION_STATUSES = new Set(['queued', 'running', 'cancel_requested']);

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isFinalProduction(production: ProductionRecord): boolean {
  return production.render_quality === 'final';
}

export function buildFirstVideoGuideState(input: {
  hasDefaultVoice: boolean;
  voiceError: boolean;
  scripts: ScriptRecord[];
  productions: ProductionRecord[];
  workflowsError: boolean;
  scriptsError: boolean;
  productionsError: boolean;
}): FirstVideoGuideState {
  const hasAnyScript = input.scripts.length > 0;
  const hasApprovedScript = input.scripts.some(script => script.status === 'approved');
  const finalProductions = input.productions.filter(isFinalProduction);
  const hasSucceededFinal = finalProductions.some(prod => prod.status === 'succeeded');
  const hasRunningFinal = finalProductions.some(prod => RUNNING_PRODUCTION_STATUSES.has(prod.status));
  const hasApprovedFinal = finalProductions.some(
    prod => prod.status === 'succeeded' && prod.review?.decision === 'approve'
  );

  const scriptQueryFailed = input.workflowsError || input.scriptsError;
  const productionQueryFailed = scriptQueryFailed || input.productionsError;

  const voiceStatus: GuideStepStatus = input.voiceError
    ? 'unknown'
    : input.hasDefaultVoice
      ? 'done'
      : 'pending';

  const writeStatus: GuideStepStatus = hasAnyScript
    ? 'done'
    : scriptQueryFailed
      ? 'unknown'
      : 'pending';

  const approveScriptStatus: GuideStepStatus = hasApprovedScript
    ? 'done'
    : scriptQueryFailed
      ? 'unknown'
      : 'pending';

  const produceFinalStatus: GuideStepStatus = hasSucceededFinal
    ? 'done'
    : hasRunningFinal
      ? 'in_progress'
      : productionQueryFailed
        ? 'unknown'
        : 'pending';

  const reviewApproveStatus: GuideStepStatus = hasApprovedFinal
    ? 'done'
    : productionQueryFailed
      ? 'unknown'
      : 'pending';

  const steps: GuideStep[] = [
    {
      id: 'voice',
      title: 'Escolher voz padrão',
      detail: 'Defina a voz local em Ajustes → Narração.',
      status: voiceStatus,
      target: 'settings',
      actionLabel: 'Abrir Ajustes',
    },
    {
      id: 'write_script',
      title: 'Escrever roteiro',
      detail: 'Crie o roteiro manual a partir de uma proposta aprovada.',
      status: writeStatus,
      target: 'production',
      actionLabel: 'Abrir Produção',
    },
    {
      id: 'approve_script',
      title: 'Aprovar roteiro',
      detail: 'Revise e aprove a versão do roteiro antes de produzir.',
      status: approveScriptStatus,
      target: 'production',
      actionLabel: 'Abrir Produção',
    },
    {
      id: 'produce_final',
      title: 'Produzir em Final 1080×1920',
      detail: 'Inicie uma produção local_pilot com qualidade Final.',
      status: produceFinalStatus,
      target: 'production',
      actionLabel: 'Abrir Produção',
    },
    {
      id: 'review_approve',
      title: 'Revisar QC/licenças e aprovar',
      detail: 'Confira vídeo, legendas, QC e licenças e registre a aprovação.',
      status: reviewApproveStatus,
      target: 'production',
      actionLabel: 'Abrir Produção',
    },
  ];

  const completedCount = steps.filter(step => step.status === 'done').length;
  return {
    steps,
    completedCount,
    isCompleted: reviewApproveStatus === 'done',
  };
}

export async function loadFirstVideoGuide(
  connection: Connection,
  signal?: AbortSignal
): Promise<FirstVideoGuideState> {
  let hasDefaultVoice = false;
  let voiceError = false;
  let workflowsError = false;
  let scriptsError = false;
  let productionsError = false;
  const allScripts: ScriptRecord[] = [];
  const allProductions: ProductionRecord[] = [];

  const voicePromise = getDefaultVoice(connection, signal)
    .then(voice => {
      hasDefaultVoice = voice !== null;
    })
    .catch(reason => {
      if (isAbortError(reason)) throw reason;
      voiceError = true;
    });

  const workflowsPromise = getWorkflows(connection)
    .then(async workflows => {
      const approvedWorkflows = workflows.filter(wf => wf.status === 'approved');
      await Promise.all(
        approvedWorkflows.map(async wf => {
          try {
            const scripts = await getWorkflowScripts(connection, wf.id, signal);
            allScripts.push(...scripts);
            const approvedScripts = scripts.filter(script => script.status === 'approved');
            await Promise.all(
              approvedScripts.map(async script => {
                try {
                  const productions = await getScriptProductions(connection, script.id, signal);
                  allProductions.push(...productions);
                } catch (reason) {
                  if (isAbortError(reason)) throw reason;
                  productionsError = true;
                }
              })
            );
          } catch (reason) {
            if (isAbortError(reason)) throw reason;
            scriptsError = true;
          }
        })
      );
    })
    .catch(reason => {
      if (isAbortError(reason)) throw reason;
      workflowsError = true;
    });

  await Promise.all([voicePromise, workflowsPromise]);

  return buildFirstVideoGuideState({
    hasDefaultVoice,
    voiceError,
    scripts: allScripts,
    productions: allProductions,
    workflowsError,
    scriptsError,
    productionsError,
  });
}
