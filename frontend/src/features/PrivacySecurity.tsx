import { useEffect, useState } from 'react';
import type { Connection, SecurityBlocker, SecurityStatusResponse } from '../services/api';
import { ApiError, getSecurityStatus } from '../services/api';
import {
  AvailabilityBadge,
  BlockerList,
  StatusCard,
  SummaryBanner,
  TOOL_CATEGORIES,
  UnverifiedBadge,
  categorizeTool,
} from '../components/SecurityWidgets';

export default function PrivacySecurity({ connection }: { connection: Connection | null }) {
  const [status, setStatus] = useState<SecurityStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!connection) {
      setStatus(null);
      setLoading(false);
      setError('');
      setErrorStatus(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    setErrorStatus(null);

    void getSecurityStatus(connection, controller.signal)
      .then(res => {
        if (!controller.signal.aborted) {
          setStatus(res);
        }
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError) {
          setErrorStatus(reason.status);
          if (reason.status === 404) {
            setError('Atualize o backend: a rota de diagnóstico de segurança (/v1/security/status) não foi encontrada (404).');
          } else if (reason.status === 401) {
            setError('Acesso não autorizado ao verificar segurança (401). Verifique o token da sessão em Ajustes.');
          } else if (reason.status >= 500) {
            setError(`Falha interna do backend ao consultar status de segurança (${reason.status}).`);
          } else {
            setError(reason.message);
          }
        } else if (reason instanceof Error) {
          if (reason.name !== 'AbortError') {
            setError(reason.message || 'Falha de conexão com o backend local.');
          }
        } else {
          setError(String(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
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
        <section className="card" aria-label="Backend desconectado">
          <p className="eyebrow bad">CONEXÃO PENDENTE</p>
          <h2>Backend desconectado.</h2>
          <p className="muted">Conecte o backend local para verificar privacidade e segurança.</p>
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
        <button
          className="button"
          disabled={loading}
          onClick={handleRefresh}
        >
          {loading ? 'VERIFICANDO…' : 'VERIFICAR NOVAMENTE'}
        </button>
      </div>

      {loading && (
        <p role="status" aria-live="polite" className="loading">
          Verificando privacidade e segurança…
        </p>
      )}

      {error && (
        <section className="card error-card" role="alert" aria-label="Erro na verificação">
          <p className="eyebrow bad">{errorStatus === 404 ? 'BACKEND DESATUALIZADO' : 'FALHA NA VERIFICAÇÃO'}</p>
          <h2>{errorStatus === 404 ? 'Atualize o backend' : 'Não foi possível verificar a segurança.'}</h2>
          <p className="error">{error}</p>
          <button className="button" onClick={handleRefresh}>
            TENTAR NOVAMENTE
          </button>
        </section>
      )}

      {status && (
        <div className="privacy-sections-stack">
          {/* 8. Faixa de Resumo: real_execution_allowed & Bloqueios Críticos */}
          <SummaryBanner
            realExecutionAllowed={status.real_execution_allowed}
            blockers={status.blockers || []}
          />

          {/* 1. Estado da Privacidade */}
          <PrivacyStateSection processing={status.processing} />

          {/* 2. Permissões do Hermes */}
          <HermesPermissionsSection
            hermes={status.hermes}
            blockers={status.blockers || []}
          />

          {/* 3. Memória */}
          <AgentMemorySection memory={status.hermes?.memory ?? null} />

          {/* 4. Modo Privado */}
          <PrivateModeSection privateMode={status.private_mode} />

          {/* 5. Serviços Externos e Consentimento */}
          <ExternalServicesSection
            connections={status.processing?.external_connections || []}
          />

          {/* 6. Auditoria */}
          <AuditSection audit={status.audit} />

          {/* 7. Credenciais */}
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
              <span className="muted small">Nenhum dado é enviado para nuvem</span>
            </div>
          ) : processing.local_only === false ? (
            <div className="row">
              <span className="tag warn">EXTERNO</span>
              <span className="muted small">Conexões para serviços externos permitidas</span>
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
  if (!hermes) {
    return (
      <StatusCard eyebrow="MOTOR HERMES" title="Permissões do Hermes">
        <UnverifiedBadge reason="Diagnóstico do agente Hermes não retornado." />
      </StatusCard>
    );
  }

  const tools = hermes.tools;
  const dangerousSet = new Set(tools?.dangerous || []);
  const effectiveTools = tools?.effective || [];

  // Agrupamento em 7 categorias canônicas
  const categorized: Record<string, string[]> = {};
  for (const cat of TOOL_CATEGORIES) {
    categorized[cat] = [];
  }
  for (const tool of effectiveTools) {
    const cat = categorizeTool(tool);
    categorized[cat].push(tool);
  }

  return (
    <StatusCard
      eyebrow="MOTOR HERMES"
      title="Permissões do Hermes"
      subtitle="Origem do perfil, restrições e ferramentas efetivas ativas."
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
          <p className="small muted">Política de restrição:</p>
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
        <p className="eyebrow">FERRAMENTAS EFETIVAS POR CATEGORIA</p>
        {!tools ? (
          <UnverifiedBadge reason="Conjunto de ferramentas não inspecionado." />
        ) : (
          <div className="tool-categories-grid">
            {TOOL_CATEGORIES.map(category => {
              const items = categorized[category] || [];
              return (
                <div key={category} className="tool-category-card">
                  <h3 className="tool-category-title">{category}</h3>
                  {items.length > 0 ? (
                    <div className="tool-tags-list">
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
                  ) : (
                    <span className="muted small">Nenhuma ferramenta ativa</span>
                  )}
                </div>
              );
            })}
          </div>
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
              <span className="tag good">NENHUM (ARMAZENAMENTO LOCAL)</span>
            ) : (
              <UnverifiedBadge reason="Provedor externo não verificado" />
            )}
          </div>
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
          'Impede gravação de logs em disco, bloqueia provedores externos e encerra sessões ao fechar.'}
      </p>
      <div className="row">
        <span className="small muted">Status atual:</span>
        {!isAvailable ? (
          <span className="tag">NÃO DISPONÍVEL</span>
        ) : privateMode?.enabled ? (
          <span className="tag good">ATIVO</span>
        ) : (
          <span className="tag muted">INATIVO</span>
        )}
      </div>
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
          O gerenciamento granular de permissões e consentimento para serviços externos ainda não está
          disponível nesta versão.
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
