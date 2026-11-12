import { useEffect, useId, useState } from 'react';
import type { Connection, SecurityBlocker, SecurityStatusResponse } from '../services/api';
import { ApiError, getSecurityStatus } from '../services/api';
import {
  AvailabilityBadge,
  BlockerList,
  StatusCard,
  StatusLegend,
  SummaryBanner,
  TOOL_CATEGORIES,
  TOOL_CATEGORY_RISK,
  UnverifiedBadge,
  categorizeTool,
} from '../components/SecurityWidgets';
import type { ToolCategory } from '../components/SecurityWidgets';

type LoadFailure = {
  kind: 'auth' | 'missing' | 'server' | 'network' | 'timeout' | 'other';
  eyebrow: string;
  title: string;
  message: string;
};

const TIMEOUT_SECONDS = 15;

function describeFailure(reason: unknown): LoadFailure {
  if (reason instanceof ApiError) {
    if (reason.status === 401) {
      return {
        kind: 'auth',
        eyebrow: 'NÃO AUTORIZADO',
        title: 'O backend recusou o token da sessão.',
        message:
          'Token inválido ou expirado (401). Reconecte o backend na aba GERAL e verifique novamente.',
      };
    }
    if (reason.status === 404) {
      return {
        kind: 'missing',
        eyebrow: 'BACKEND DESATUALIZADO',
        title: 'Atualize o backend',
        message:
          'A rota GET /v1/security/status não existe neste backend (404). Nenhum diagnóstico foi obtido.',
      };
    }
    if (reason.status >= 500) {
      return {
        kind: 'server',
        eyebrow: 'FALHA NO BACKEND',
        title: 'O backend não conseguiu montar o diagnóstico.',
        message: `Erro interno (${reason.status}). Verifique novamente; se persistir, consulte os registros do backend.`,
      };
    }
    return {
      kind: 'other',
      eyebrow: 'FALHA NA VERIFICAÇÃO',
      title: 'Não foi possível verificar a segurança.',
      message: `${reason.message} (${reason.status}).`,
    };
  }
  if (reason instanceof Error && reason.name === 'AbortError') {
    return {
      kind: 'timeout',
      eyebrow: 'TEMPO ESGOTADO',
      title: 'O backend não respondeu a tempo.',
      message: `Sem resposta em ${TIMEOUT_SECONDS} segundos. Verifique novamente.`,
    };
  }
  return {
    kind: 'network',
    eyebrow: 'SEM CONEXÃO',
    title: 'Não foi possível alcançar o backend local.',
    message: 'Confirme que o aplicativo está em execução e verifique novamente.',
  };
}

export default function PrivacySecurity({ connection }: { connection: Connection | null }) {
  const [status, setStatus] = useState<SecurityStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [revision, setRevision] = useState(0);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    if (!connection) {
      setStatus(null);
      setLoading(false);
      setFailure(null);
      setAnnounce('');
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setFailure(null);
    setAnnounce('');

    void getSecurityStatus(connection, controller.signal)
      .then(res => {
        if (controller.signal.aborted) return;
        setStatus(res);
        setAnnounce('Diagnóstico de segurança atualizado.');
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        // Sem dados antigos: um diagnóstico obsoleto não pode sugerir proteção atual.
        setStatus(null);
        setFailure(describeFailure(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [connection, revision]);

  function handleRefresh() {
    setRevision(r => r + 1);
  }

  // Estado: Backend desconectado
  if (!connection) {
    return (
      <section className="privacy-security-page" aria-label="Privacidade e Segurança">
        <section className="card" aria-label="Backend desconectado" role="status" aria-live="polite">
          <p className="eyebrow bad">CONEXÃO PENDENTE</p>
          <h2>Backend desconectado.</h2>
          <p className="muted">
            Nenhum diagnóstico foi obtido. Na aba GERAL, conecte o backend local; depois, volte aqui e
            verifique novamente.
          </p>
        </section>
      </section>
    );
  }

  return (
    <section className="privacy-security-page" aria-label="Privacidade e Segurança">
      <div className="row spread page-actions-bar">
        <div>
          <p className="eyebrow accent">SEGURANÇA E PRIVACIDADE</p>
          <h2>Diagnóstico de Integridade e Isolamento</h2>
          <p className="muted">
            {status?.checked_at
              ? `Última verificação: ${new Date(status.checked_at).toLocaleString('pt-BR')}`
              : 'Alimentado exclusivamente por GET /v1/security/status.'}
          </p>
        </div>
        {!failure && (
          <button className="button" disabled={loading} onClick={handleRefresh}>
            {loading ? 'VERIFICANDO…' : 'VERIFICAR NOVAMENTE'}
          </button>
        )}
      </div>

      {/* Região viva única e persistente: anuncia carregamento e conclusão. */}
      <p role="status" aria-live="polite" className={loading ? 'loading' : 'visually-hidden'}>
        {loading ? 'Verificando privacidade e segurança…' : announce}
      </p>

      {failure && (
        <section
          className="card error-card"
          role="alert"
          aria-label="Erro na verificação"
          data-failure={failure.kind}
        >
          <p className="eyebrow bad">{failure.eyebrow}</p>
          <h2>{failure.title}</h2>
          <p className="error">{failure.message}</p>
          <div>
            <button className="button" disabled={loading} onClick={handleRefresh}>
              {loading ? 'VERIFICANDO…' : 'VERIFICAR NOVAMENTE'}
            </button>
          </div>
        </section>
      )}

      <StatusLegend />

      {status && (
        <div className="privacy-sections-stack">
          {/* Faixa de resumo: o que o Hórus bloqueia × o que o perfil Hermes permite */}
          <SummaryBanner
            realExecutionAllowed={status.real_execution_allowed}
            blockers={status.blockers || []}
            tools={
              status.hermes?.tools
                ? {
                    restricted: status.hermes.tools.restricted,
                    total: status.hermes.tools.effective.length,
                    dangerous: status.hermes.tools.effective.filter(t =>
                      status.hermes.tools?.dangerous.includes(t)
                    ).length,
                  }
                : null
            }
          />

          <PrivacyStateSection processing={status.processing} />

          <HermesPermissionsSection
            hermes={status.hermes}
            blockers={status.blockers || []}
          />

          <AgentMemorySection memory={status.hermes?.memory ?? null} />

          <RadarRetentionSection radar={status.radar ?? null} />

          <PrivateModeSection privateMode={status.private_mode} />

          <ExternalServicesSection
            connections={status.processing?.external_connections || []}
          />

          <AuditSection audit={status.audit} />

          <CredentialsSection credentials={status.credentials} />
        </div>
      )}
    </section>
  );
}

// --- 1. Estado da Privacidade ---
function PrivacyStateSection({
  processing,
}: {
  processing: SecurityStatusResponse['processing'] | null;
}) {
  if (!processing) {
    return (
      <StatusCard eyebrow="PROCESSAMENTO E REDE" title="Estado da Privacidade">
        <UnverifiedBadge reason="Dados de processamento ausentes no diagnóstico." />
      </StatusCard>
    );
  }

  return (
    <StatusCard
      eyebrow="PROCESSAMENTO E REDE"
      title="Estado da Privacidade"
      subtitle="Controle de execução em dispositivo e conectividade externa."
      ariaLabel="Estado da Privacidade"
    >
      <div className="info-grid">
        <div className="info-block">
          <p className="small muted">Isolamento de processamento:</p>
          {processing.local_only === true ? (
            <div className="row">
              <span className="tag good">SOMENTE LOCAL</span>
              <span className="muted small">Informado pelo backend; não é bloqueio de rede.</span>
            </div>
          ) : processing.local_only === false ? (
            <div className="row">
              <span className="tag warn">EXTERNO</span>
              <span className="muted small">O backend admite conexões externas.</span>
            </div>
          ) : (
            <UnverifiedBadge reason="Origem de processamento não informada" />
          )}
        </div>

        <div className="info-block">
          <p className="small muted">Executor padrão de fluxos:</p>
          {processing.workflow_executor_default ? (
            <code>{processing.workflow_executor_default}</code>
          ) : (
            <UnverifiedBadge reason="Executor de fluxo não verificado" />
          )}
        </div>

        <div className="info-block">
          <p className="small muted">Executor do Radar:</p>
          {processing.radar_executor ? (
            <code>{processing.radar_executor}</code>
          ) : (
            <UnverifiedBadge reason="Executor do radar não verificado" />
          )}
        </div>
      </div>

      <div className="connections-table-wrapper">
        <p className="eyebrow">CONEXÕES CONFIGURADAS</p>
        {processing.external_connections && processing.external_connections.length > 0 ? (
          <div className="data-table-container">
            <table className="data-table" aria-label="Tabela de conexões">
              <thead>
                <tr>
                  <th>Identificador</th>
                  <th>Tipo</th>
                  <th>Destino</th>
                  <th>Estado</th>
                  <th>Finalidade</th>
                </tr>
              </thead>
              <tbody>
                {processing.external_connections.map(conn => (
                  <tr key={conn.id}>
                    <td>
                      <code>{conn.id}</code>
                    </td>
                    <td>
                      <span className={`tag ${conn.kind === 'loopback' ? 'good' : 'warn'}`}>
                        {conn.kind === 'loopback' ? 'LOOPBACK' : 'EXTERNA'}
                      </span>
                    </td>
                    <td>
                      <code>{conn.target}</code>
                    </td>
                    <td>
                      <span className={`tag ${conn.enabled ? 'good' : ''}`}>
                        {conn.enabled ? 'HABILITADA' : 'DESATIVADA'}
                      </span>
                    </td>
                    <td className="muted">{conn.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Nenhuma conexão registrada no backend.</p>
        )}
      </div>
    </StatusCard>
  );
}

// --- 2. Permissões do Hermes ---
function HermesPermissionsSection({
  hermes,
  blockers,
}: {
  hermes: SecurityStatusResponse['hermes'] | null;
  blockers: SecurityBlocker[];
}) {
  const baseId = useId();
  const tools = hermes?.tools ?? null;
  const dangerousSet = new Set(tools?.dangerous || []);
  const effectiveTools = tools?.effective || [];

  // Agrupamento em categorias canônicas; nenhuma ferramenta é omitida.
  const categorized = new Map<ToolCategory, string[]>();
  for (const cat of TOOL_CATEGORIES) categorized.set(cat, []);
  for (const tool of effectiveTools) categorized.get(categorizeTool(tool))?.push(tool);

  const dangerCount = (cat: ToolCategory) =>
    (categorized.get(cat) || []).filter(t => dangerousSet.has(t)).length;

  // Categorias com ferramentas perigosas primeiro; depois, a ordem canônica.
  const populated = TOOL_CATEGORIES.filter(cat => (categorized.get(cat) || []).length > 0).sort(
    (a, b) => dangerCount(b) - dangerCount(a)
  );
  const empty = TOOL_CATEGORIES.filter(cat => (categorized.get(cat) || []).length === 0);
  const outsideEffective = [...dangerousSet].filter(t => !effectiveTools.includes(t));

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(populated.map(cat => [cat, dangerCount(cat) > 0]))
  );
  const allOpen = populated.length > 0 && populated.every(cat => open[cat]);

  if (!hermes) {
    return (
      <StatusCard eyebrow="MOTOR HERMES" title="Permissões do Hermes">
        <UnverifiedBadge reason="Diagnóstico do agente Hermes não retornado." />
      </StatusCard>
    );
  }

  return (
    <StatusCard
      eyebrow="MOTOR HERMES"
      title="Permissões do Hermes"
      subtitle="O que o perfil Hermes permite, independentemente do que o Hórus bloqueia."
      ariaLabel="Permissões do Hermes"
    >
      <div className="info-grid">
        <div className="info-block">
          <p className="small muted">Tipo de conexão:</p>
          {hermes.connection === 'loopback' ? (
            <span className="tag good">LOOPBACK LOCAL</span>
          ) : hermes.connection === 'not_configured' ? (
            <span className="tag warn">NÃO CONFIGURADA</span>
          ) : hermes.connection === 'invalid' ? (
            <span className="tag bad">INVÁLIDA</span>
          ) : hermes.connection ? (
            <span className="tag">{hermes.connection}</span>
          ) : (
            <UnverifiedBadge reason="Conexão não verificada" />
          )}
        </div>

        <div className="info-block">
          <p className="small muted">Perfil do agente:</p>
          {hermes.profile_found === true ? (
            <div>
              <span className="tag good">LOCALIZADO</span>
              {hermes.profile_label && (
                <p className="small" style={{ marginTop: '4px' }}>
                  <code>{hermes.profile_label}</code>
                </p>
              )}
            </div>
          ) : hermes.profile_found === false ? (
            <span className="tag bad">NÃO LOCALIZADO</span>
          ) : (
            <UnverifiedBadge reason="Status do perfil não verificado" />
          )}
        </div>

        <div className="info-block">
          <p className="small muted">Origem do toolset:</p>
          {tools?.source ? (
            <code>{tools.source}</code>
          ) : (
            <UnverifiedBadge reason="Origem do toolset não informada" />
          )}
        </div>

        <div className="info-block">
          <p className="small muted">Política de restrição do perfil:</p>
          {tools?.restricted === true ? (
            <span className="tag good">RESTRITO</span>
          ) : tools?.restricted === false ? (
            <span className="tag bad">NÃO RESTRITO</span>
          ) : (
            <UnverifiedBadge reason="Nível de restrição não informado" />
          )}
        </div>
      </div>

      <div className="tools-section">
        <div className="row spread tools-header">
          <div>
            <p className="eyebrow">FERRAMENTAS EFETIVAS POR CATEGORIA</p>
            {tools && (
              <p className="small muted" data-testid="tools-total">
                {effectiveTools.length} {effectiveTools.length === 1 ? 'ferramenta' : 'ferramentas'} em{' '}
                {populated.length} {populated.length === 1 ? 'categoria' : 'categorias'}
                {dangerousSet.size > 0 ? ` · ${dangerousSet.size} de alto risco` : ''}
              </p>
            )}
          </div>
          {tools && populated.length > 0 && (
            <button
              type="button"
              className="button"
              onClick={() =>
                setOpen(Object.fromEntries(populated.map(cat => [cat, !allOpen])))
              }
            >
              {allOpen ? 'RECOLHER TODAS' : 'EXPANDIR TODAS'}
            </button>
          )}
        </div>

        {!tools ? (
          <UnverifiedBadge reason="Conjunto de ferramentas não inspecionado." />
        ) : effectiveTools.length === 0 ? (
          <p className="muted small">O diagnóstico não lista nenhuma ferramenta efetiva.</p>
        ) : (
          <div className="tool-categories-grid">
            {populated.map(category => {
              const items = [...(categorized.get(category) || [])].sort(
                (a, b) => Number(dangerousSet.has(b)) - Number(dangerousSet.has(a))
              );
              const danger = dangerCount(category);
              const isOpen = !!open[category];
              const listId = `${baseId}-${category.replace(/\W+/g, '-')}`;
              return (
                <div
                  key={category}
                  className={`tool-category-card ${danger > 0 ? 'has-danger' : ''}`}
                >
                  <div className="row spread tool-category-head">
                    <h3 className="tool-category-title">
                      <button
                        type="button"
                        className="disclosure-button"
                        aria-expanded={isOpen}
                        aria-controls={listId}
                        onClick={() => setOpen(prev => ({ ...prev, [category]: !isOpen }))}
                      >
                        {category}
                      </button>
                    </h3>
                    <span className="small muted tool-count">
                      {items.length}
                      {danger > 0 ? ` · ${danger} de alto risco` : ''}
                    </span>
                  </div>
                  <p className="small muted">{TOOL_CATEGORY_RISK[category]}</p>
                  <div id={listId} className="tool-tags-list" hidden={!isOpen}>
                    {items.map(tool => {
                      const isDangerous = dangerousSet.has(tool);
                      return (
                        <div
                          key={tool}
                          className={`tool-tag-item ${isDangerous ? 'dangerous' : ''}`}
                        >
                          <code>{tool}</code>
                          {isDangerous && (
                            <span className="tag bad tool-danger-tag">PERIGOSA</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tools && empty.length > 0 && effectiveTools.length > 0 && (
          <p className="small muted">Sem ferramentas em: {empty.join(', ')}.</p>
        )}
        {outsideEffective.length > 0 && (
          <p className="small muted">
            Marcadas como de alto risco, mas fora da lista efetiva:{' '}
            {outsideEffective.map(t => (
              <code key={t}>{t}</code>
            ))}
          </p>
        )}
      </div>

      {blockers.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <BlockerList blockers={blockers} title="Bloqueios e Condições do Hermes" />
        </div>
      )}
    </StatusCard>
  );
}

// --- 3. Memória ---
function AgentMemorySection({
  memory,
}: {
  memory: SecurityStatusResponse['hermes']['memory'];
}) {
  return (
    <StatusCard
      eyebrow="PERSISTÊNCIA E CONTEXTO"
      title="Memória do Agente"
      subtitle="Isolamento de preferências, histórico e controle de gravação."
      ariaLabel="Memória do Agente"
    >
      {!memory ? (
        <UnverifiedBadge reason="Configurações de memória não verificadas no backend." />
      ) : (
        <div className="info-grid">
          <div className="info-block">
            <p className="small muted">Memória local:</p>
            {memory.local_enabled === true ? (
              <span className="tag good">HABILITADA</span>
            ) : memory.local_enabled === false ? (
              <span className="tag muted">DESATIVADA</span>
            ) : (
              <UnverifiedBadge reason="Estado não verificado" />
            )}
          </div>

          <div className="info-block">
            <p className="small muted">Perfil do usuário:</p>
            {memory.user_profile_enabled === true ? (
              <span className="tag good">HABILITADO</span>
            ) : memory.user_profile_enabled === false ? (
              <span className="tag muted">DESATIVADO</span>
            ) : (
              <UnverifiedBadge reason="Estado não verificado" />
            )}
          </div>

          <div className="info-block">
            <p className="small muted">Aprovação de escrita:</p>
            {memory.write_approval === true ? (
              <span className="tag good">EXIGE APROVAÇÃO</span>
            ) : memory.write_approval === false ? (
              <span className="tag warn">SEM APROVAÇÃO</span>
            ) : (
              <UnverifiedBadge reason="Estado não verificado" />
            )}
          </div>

          <div className="info-block">
            <p className="small muted">Provedor externo:</p>
            {memory.external_provider ? (
              <span className="tag warn">{memory.external_provider}</span>
            ) : memory.external_provider === null ? (
              <span className="tag good">NENHUM INFORMADO</span>
            ) : (
              <UnverifiedBadge reason="Provedor externo não verificado" />
            )}
          </div>
        </div>
      )}
    </StatusCard>
  );
}

// --- 3b. Retenção do Radar ---
const CLEANUP_STATUS: Record<string, { label: string; tone: string; note: string }> = {
  ok: { label: 'CONCLUÍDO', tone: 'good', note: 'Todos os workflows foram processados.' },
  partial: {
    label: 'PARCIAL',
    tone: 'warn',
    note: 'Algum workflow falhou e foi preservado sem alteração.',
  },
  failed: { label: 'FALHOU', tone: 'bad', note: 'O ciclo não foi concluído.' },
};

function RadarRetentionSection({ radar }: { radar: SecurityStatusResponse['radar'] | null }) {
  const cleanup = radar?.automatic_cleanup ?? null;

  return (
    <StatusCard
      eyebrow="RETENÇÃO DE DADOS"
      title="Retenção do Radar"
      subtitle="Limpeza automática dos dados coletados pelo Radar."
      ariaLabel="Retenção do Radar"
      badge={
        cleanup ? <AvailabilityBadge available={cleanup.available === true} /> : undefined
      }
    >
      {!radar ? (
        <UnverifiedBadge reason="O diagnóstico não informou a retenção do Radar." />
      ) : (
        <div className="info-grid">
          <div className="info-block">
            <p className="small muted">Retenção configurada:</p>
            {typeof radar.retention_days === 'number' ? (
              <span>{radar.retention_days} dias</span>
            ) : (
              <UnverifiedBadge reason="Prazo não informado" />
            )}
          </div>

          <div className="info-block">
            <p className="small muted">Coleta de rede do Radar:</p>
            {radar.network_enabled === true ? (
              <span className="tag warn">HABILITADA</span>
            ) : radar.network_enabled === false ? (
              <span className="tag">DESATIVADA</span>
            ) : (
              <UnverifiedBadge reason="Estado não informado" />
            )}
          </div>

          {!cleanup ? (
            <div className="info-block">
              <p className="small muted">Limpeza automática:</p>
              <UnverifiedBadge reason="Ciclo de limpeza não informado" />
            </div>
          ) : cleanup.available !== true ? (
            <div className="info-block">
              <p className="small muted">Limpeza automática:</p>
              <p className="small muted">Rotina não disponível nesta versão do backend.</p>
            </div>
          ) : (
            <>
              <div className="info-block">
                <p className="small muted">Intervalo da limpeza:</p>
                {typeof cleanup.interval_hours === 'number' ? (
                  <span>a cada {cleanup.interval_hours} h</span>
                ) : (
                  <UnverifiedBadge reason="Intervalo não informado" />
                )}
              </div>

              <div className="info-block" data-testid="cleanup-last-run">
                <p className="small muted">Último ciclo:</p>
                {cleanup.last_run_at ? (
                  <>
                    <span>{new Date(cleanup.last_run_at).toLocaleString('pt-BR')}</span>
                    {cleanup.last_status && CLEANUP_STATUS[cleanup.last_status] ? (
                      <>
                        <span className={`tag ${CLEANUP_STATUS[cleanup.last_status].tone}`}>
                          {CLEANUP_STATUS[cleanup.last_status].label}
                        </span>
                        <span className="small muted">
                          {CLEANUP_STATUS[cleanup.last_status].note}
                        </span>
                      </>
                    ) : cleanup.last_status ? (
                      <span className="tag">{cleanup.last_status}</span>
                    ) : (
                      <UnverifiedBadge reason="Estado do ciclo não informado" />
                    )}
                  </>
                ) : (
                  <span className="muted">Ainda não executado nesta sessão</span>
                )}
              </div>

              <div className="info-block">
                <p className="small muted">Workflows redigidos no último ciclo:</p>
                {typeof cleanup.redacted_workflows === 'number' ? (
                  <span>{cleanup.redacted_workflows}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </StatusCard>
  );
}

// --- 4. Modo Privado ---
function PrivateModeSection({
  privateMode,
}: {
  privateMode: SecurityStatusResponse['private_mode'];
}) {
  const isAvailable = privateMode?.available === true;

  return (
    <StatusCard
      eyebrow="ISOLAMENTO REFORÇADO"
      title="Modo Privado"
      subtitle="Execução sem persistência local nem comunicação de rede."
      badge={<AvailabilityBadge available={isAvailable} reason={privateMode?.reason} />}
      ariaLabel="Modo Privado"
    >
      <p className="muted">
        {privateMode?.reason ||
          (isAvailable
            ? 'Impede gravação de logs em disco, bloqueia provedores externos e encerra sessões ao fechar.'
            : 'Recurso ainda não implementado; não há controle para ativá-lo.')}
      </p>
      {isAvailable && !privateMode?.enabled && (
        <div className="row">
          <span className="small muted">Estado atual:</span>
          <span className="tag muted">INATIVO</span>
        </div>
      )}
      {/* Regra: Sem interruptor ativo nesta etapa */}
    </StatusCard>
  );
}

// --- 5. Serviços Externos e Consentimento ---
function ExternalServicesSection({
  connections,
}: {
  connections: SecurityStatusResponse['processing']['external_connections'];
}) {
  const externalList = (connections || []).filter(c => c.kind === 'external');

  return (
    <StatusCard
      eyebrow="TRÁFEGO DE REDE"
      title="Serviços Externos"
      subtitle="Destinos externos e gestão futura de consentimento."
      ariaLabel="Serviços Externos"
    >
      <div className="external-services-list">
        <p className="eyebrow">DESTINOS EXTERNOS RECONHECIDOS</p>
        {externalList.length > 0 ? (
          <ul className="external-conn-list">
            {externalList.map(item => (
              <li key={item.id} className="external-conn-item">
                <div className="row spread">
                  <code>{item.id}</code>
                  <span className={`tag ${item.enabled ? 'good' : ''}`}>
                    {item.enabled ? 'HABILITADA' : 'DESATIVADA'}
                  </span>
                </div>
                <p className="small muted">
                  Destino: <code>{item.target}</code> · {item.purpose}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nenhuma conexão externa configurada.</p>
        )}
      </div>

      <div className="consent-future-area">
        <div className="row spread">
          <p className="eyebrow">CONSENTIMENTO DE DADOS EXTERNOS</p>
          <AvailabilityBadge
            available={false}
            reason="Gerenciamento de consentimento granular previsto para fases futuras."
          />
        </div>
        <p className="muted small">
          Sem controles nesta versão: o Hórus não pede nem registra consentimento por serviço externo.
        </p>
        {/* Regra: Sem controles ativos */}
      </div>
    </StatusCard>
  );
}

// --- 6. Auditoria ---
function AuditSection({
  audit,
}: {
  audit: SecurityStatusResponse['audit'];
}) {
  const isAvailable = audit?.available === true;

  return (
    <StatusCard
      eyebrow="REGISTRO E CONFORMIDADE"
      title="Auditoria de Transmissões"
      subtitle="Registro estruturado de chamadas, requisições externas e eventos de segurança."
      badge={<AvailabilityBadge available={isAvailable} reason={audit?.reason} />}
      ariaLabel="Auditoria de Transmissões"
    >
      <p className="muted">
        {audit?.reason ||
          'Registro de transmissões e eventos de segurança com carimbo de data/hora.'}
      </p>

      {/* Estrutura vazia de auditoria enquanto available: false */}
      <div className="data-table-container">
        <table className="data-table" aria-label="Tabela de auditoria">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Destino</th>
              <th>Operação</th>
              <th>Finalidade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '16px' }}>
                Nenhum evento registrado. O subsistema de auditoria não está ativo nesta versão.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </StatusCard>
  );
}

// --- 7. Credenciais (Nunca renderiza valores) ---
function CredentialsSection({
  credentials,
}: {
  credentials: SecurityStatusResponse['credentials'] | null;
}) {
  const items = credentials?.items || [];

  return (
    <StatusCard
      eyebrow="SEGREDOS E CHAVES"
      title="Armazenamento de Credenciais"
      subtitle="Mapeamento de proteção dos segredos da operação. Valores de tokens e chaves nunca são expostos."
      ariaLabel="Armazenamento de Credenciais"
    >
      {items.length > 0 ? (
        <div className="credentials-items-grid">
          {items.map(item => (
            <div key={item.id} className="credential-item">
              <div className="row spread">
                <h3>{item.id}</h3>
                <span className="tag">
                  {item.storage === 'memory'
                    ? 'MEMÓRIA DA SESSÃO'
                    : item.storage === 'local_file'
                    ? 'ARQUIVO LOCAL'
                    : item.storage}
                </span>
              </div>
              {item.description && <p className="muted small">{item.description}</p>}
              <div className="credential-meta">
                <p className="small">
                  <strong>Armazenamento:</strong>{' '}
                  {item.storage === 'memory'
                    ? 'Volátil (descartado ao encerrar o aplicativo)'
                    : item.storage === 'local_file'
                    ? 'Arquivo persistido no disco'
                    : item.storage}
                </p>
                <p className="small">
                  <strong>Proteção:</strong>{' '}
                  {item.protection ? (
                    item.protection
                  ) : (
                    <UnverifiedBadge reason="Proteção não informada" />
                  )}
                </p>
                {item.location_label && (
                  <p className="small">
                    <strong>Localização:</strong> <code>{item.location_label}</code>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">Nenhuma credencial catalogada.</p>
      )}
    </StatusCard>
  );
}
