import { useEffect, useMemo, useState } from 'react';
import type { Connection } from '../../services/api';
import { getDefaultVoice, getProviders } from '../../services/narration';
import type { CommercialUse, NarrationProvider, NarrationVoice } from '../../services/narration';
import type { ProductionNarrationSelection, RenderQuality } from '../../services/production';

export const RENDER_QUALITY_OPTIONS: Record<
  RenderQuality,
  { label: string; resolution: string; estimate: string }
> = {
  draft: {
    label: 'Rascunho',
    resolution: '540×960',
    estimate: 'referência de ensaios locais: ≈ 100 a 150 s no total',
  },
  final: {
    label: 'Final',
    resolution: '1080×1920',
    estimate: 'referência de ensaios locais: ≈ 140 a 160 s no total',
  },
};

const COMMERCIAL_LABELS: Record<CommercialUse, string> = {
  allowed: 'Uso comercial: permitido',
  restricted: 'Uso comercial: restrito',
  unknown: 'Uso comercial: desconhecido (trate como não permitido)',
};

const PROVIDER_STATUS_LABELS: Record<string, string> = {
  available: 'disponível',
  not_installed: 'não instalado',
  not_configured: 'não configurado',
  disabled: 'desabilitado',
  blocked: 'bloqueado',
};

function isSelectableProvider(provider: NarrationProvider): boolean {
  // Provedores pagos exigem autorização explícita de custo e nunca são acionados por esta tela.
  return provider.kind === 'local' && provider.status === 'available' && provider.voices.length > 0;
}

export type VoiceSource = 'preference' | 'first_available';

export default function ProductionLaunchOptions({
  connection,
  disabled,
  quality,
  onQualityChange,
  onVoiceChange,
}: {
  connection: Connection | null;
  disabled: boolean;
  quality: RenderQuality;
  onQualityChange: (quality: RenderQuality) => void;
  onVoiceChange: (voice: ProductionNarrationSelection | null) => void;
}) {
  const [providers, setProviders] = useState<NarrationProvider[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [providerId, setProviderId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [source, setSource] = useState<VoiceSource | null>(null);

  useEffect(() => {
    if (!connection) {
      setState('error');
      setError('Sem conexão com o backend local.');
      return;
    }
    const controller = new AbortController();
    setState('loading');
    setError('');
    void Promise.all([
      getProviders(connection, controller.signal),
      getDefaultVoice(connection, controller.signal).catch(() => null),
    ])
      .then(([loaded, preference]) => {
        if (controller.signal.aborted) return;
        setProviders(loaded);
        const preferred = preference
          ? loaded.find(
              p =>
                p.id === preference.provider &&
                isSelectableProvider(p) &&
                p.voices.some(v => v.id === preference.voice_id)
            )
          : undefined;
        if (preferred && preference) {
          setProviderId(preferred.id);
          setVoiceId(preference.voice_id);
          setSource('preference');
        } else {
          const first = loaded.find(isSelectableProvider);
          setProviderId(first?.id ?? '');
          setVoiceId(first?.voices[0]?.id ?? '');
          setSource(first ? 'first_available' : null);
        }
        setState('ready');
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setState('error');
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [connection]);

  const provider = useMemo(
    () => providers.find(item => item.id === providerId) ?? null,
    [providers, providerId]
  );
  const voice: NarrationVoice | null = provider?.voices.find(item => item.id === voiceId) ?? null;

  useEffect(() => {
    onVoiceChange(provider && voice ? { provider: provider.id, voice_id: voice.id } : null);
  }, [provider?.id, voice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const qualityInfo = RENDER_QUALITY_OPTIONS[quality];

  return (
    <div className="fact-item" role="group" aria-label="Voz e qualidade da produção">
      <span className="eyebrow">VOZ E QUALIDADE DO PILOTO LOCAL</span>

      {state === 'loading' && (
        <p className="loading" role="status">
          Carregando vozes disponíveis…
        </p>
      )}
      {state === 'error' && (
        <p className="error" role="alert">
          Não foi possível carregar as vozes ({error}). A produção usará a voz padrão do backend.
        </p>
      )}
      {state === 'ready' && !providers.some(isSelectableProvider) && (
        <p className="muted" role="status">
          Nenhuma voz local disponível. A produção usará a voz padrão do backend; se ele não tiver
          motor de voz, a execução ficará bloqueada.
        </p>
      )}

      {state === 'ready' && providers.length > 0 && (
        <div className="form-row" style={{ alignItems: 'end' }}>
          <label>
            Provedor de voz
            <select
              aria-label="Provedor de voz"
              value={providerId}
              disabled={disabled}
              onChange={event => {
                const next = providers.find(item => item.id === event.target.value);
                setProviderId(event.target.value);
                setVoiceId(next?.voices[0]?.id ?? '');
                setSource(null);
              }}
            >
              {providers.map(item => {
                const selectable = isSelectableProvider(item);
                const reason =
                  item.kind === 'paid_api'
                    ? 'pago: exige autorização de custo fora desta tela'
                    : (PROVIDER_STATUS_LABELS[item.status] ?? item.status);
                return (
                  <option key={item.id} value={item.id} disabled={!selectable}>
                    {item.name}
                    {selectable ? '' : ` — indisponível (${reason})`}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Voz
            <select
              aria-label="Voz da narração"
              value={voiceId}
              disabled={disabled || !provider || !isSelectableProvider(provider)}
              onChange={event => {
                setVoiceId(event.target.value);
                setSource(null);
              }}
            >
              {(provider && isSelectableProvider(provider) ? provider.voices : []).map(item => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.language})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {provider && voice && isSelectableProvider(provider) && (
        <div role="note" aria-label="Licença da voz escolhida">
          <small className="muted">
            {source === 'preference' && <strong>Pré-selecionada pela sua preferência de voz. </strong>}
            Licença da voz: <strong>{voice.license.name}</strong> ·{' '}
            <strong>{COMMERCIAL_LABELS[voice.commercial_use]}</strong>
            {voice.notes ? ` · ${voice.notes}` : ''} · Licença do motor:{' '}
            <strong>{provider.engine_license.name}</strong>
          </small>
        </div>
      )}

      <label>
        Qualidade do vídeo
        <select
          aria-label="Qualidade da renderização"
          value={quality}
          disabled={disabled}
          onChange={event => onQualityChange(event.target.value as RenderQuality)}
        >
          {(Object.keys(RENDER_QUALITY_OPTIONS) as RenderQuality[]).map(key => (
            <option key={key} value={key}>
              {RENDER_QUALITY_OPTIONS[key].label} {RENDER_QUALITY_OPTIONS[key].resolution}
            </option>
          ))}
        </select>
      </label>
      <small className="muted" role="note" aria-label="Tempo estimado da renderização">
        Tempo estimado ({qualityInfo.label.toLowerCase()} {qualityInfo.resolution}):{' '}
        {qualityInfo.estimate}. É uma estimativa, não uma medição desta execução; varia com a
        máquina e a voz (vozes como Kokoro podem levar mais de 1 minuto só na narração).
      </small>
    </div>
  );
}
