import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '../../services/api';
import {
  DEFAULT_PREVIEW_TEXT, PREVIEW_MAX_CHARS, estimateNarration, getDefaultVoice, getProviders,
  previewNarration, removeElevenLabsCredential, setDefaultVoice, setElevenLabsCredential,
} from '../../services/narration';
import type { CommercialUse, DefaultVoice, NarrationEstimate, NarrationProvider, NarrationVoice, ProviderStatus } from '../../services/narration';
import './narration.css';

const STATUS: Record<ProviderStatus, { label: string; tone: string }> = {
  available: { label: 'DISPONÍVEL', tone: 'good' }, not_installed: { label: 'NÃO INSTALADO', tone: 'warn' },
  not_configured: { label: 'NÃO CONFIGURADO', tone: 'warn' }, disabled: { label: 'DESABILITADO', tone: '' }, blocked: { label: 'BLOQUEADO', tone: 'bad' },
};
const COMMERCIAL: Record<CommercialUse, { label: string; tone: string; warning: string | null }> = {
  allowed: { label: 'USO COMERCIAL: PERMITIDO', tone: 'good', warning: null },
  restricted: { label: 'USO COMERCIAL: RESTRITO', tone: 'bad', warning: 'Uso comercial restrito. Não use esta voz em conteúdo publicado sem revisar a licença.' },
  unknown: { label: 'USO COMERCIAL: DESCONHECIDO', tone: 'warn', warning: 'Uso comercial desconhecido. Trate como não permitido até verificar a licença.' },
};
const CREDITS_SOURCE = { not_checked: 'não verificados', api: 'lidos da API do provedor', mock: 'simulados (mock)' } as const;
const reasonText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

function LicenseLink({ name, url }: { name: string; url: string | null }) {
  return url && /^https?:\/\//i.test(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{name}</a> : <>{name}</>;
}

function EstimateView({ estimate }: { estimate: NarrationEstimate }) {
  const { cost, credits } = estimate;
  const price = cost.source === 'configured_price' && cost.amount !== null
    ? `${cost.amount}${cost.currency ? ` ${cost.currency}` : ''}${cost.basis ? ` (${cost.basis})` : ''}`
    : null;
  return <div className="narration-estimate" role="status" aria-label="Estimativa de custo">
    <span>Caracteres: {estimate.characters}</span>
    <span>Custo estimado: {price ?? 'desconhecido — nenhum preço configurado'} · fonte: {cost.source}</span>
    <span>Créditos: {credits.source === 'not_checked' ? 'não verificados' : `necessários ${credits.required ?? '—'} · disponíveis ${credits.available ?? '—'}`} · fonte: {credits.source} ({CREDITS_SOURCE[credits.source]})</span>
    {estimate.requires_authorization && <span>Esta geração exigirá autorização explícita com o custo exibido. Nenhuma geração foi feita.</span>}
  </div>;
}

function VoiceRow({ connection, provider, voice, text, isDefault, onDefault }: {
  connection: Connection; provider: NarrationProvider; voice: NarrationVoice; text: string; isDefault: boolean; onDefault: () => void;
}) {
  const [audio, setAudio] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'generating' | 'playing' | 'paused' | 'error'>('idle');
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<NarrationEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  useEffect(() => () => { previewAbortRef.current?.abort(); }, []);

  function stopPreview() {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (player.current) {
      player.current.pause();
      player.current.currentTime = 0;
    }
    setBusy(false);
    setPreviewState('idle');
  }

  async function listen() {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setBusy(true);
    setPreviewState('generating');
    setError('');
    try {
      const blob = await previewNarration(
        connection,
        { provider: provider.id, voice_id: voice.id, text },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setAudio(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reasonText(reason));
      setPreviewState('error');
    } finally {
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
      }
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!audio || !player.current) return;
    player.current.currentTime = 0;
    void player.current.play().then(
      () => setPreviewState('playing'),
      () => setPreviewState('paused')
    );
  }, [audio]);
  async function estimateCost() {
    setEstimating(true); setError('');
    try { setEstimate(await estimateNarration(connection, { provider: provider.id, voice_id: voice.id, text })); }
    catch (reason) { setEstimate(null); setError(reasonText(reason)); } finally { setEstimating(false); }
  }
  const commercial = COMMERCIAL[voice.commercial_use];
  const label = `${voice.name} (${provider.name})`;
  const canStop = busy || previewState === 'playing' || previewState === 'paused' || Boolean(audio);
  return <li className={`narration-voice ${isDefault ? 'is-default' : ''}`} aria-label={label}>
    <div className="row spread"><h4>{voice.name}</h4><span className="tag">{voice.language}</span></div>
    <div className="narration-actions">
      <span className={`tag ${commercial.tone}`}>{commercial.label}</span>
      {isDefault && <span className="tag good">VOZ PADRÃO</span>}
    </div>
    <p className="muted">Licença da voz: <LicenseLink name={voice.license.name} url={voice.license.url} /></p>
    {commercial.warning && <p className="narration-warning" role="note">{commercial.warning}</p>}
    {voice.notes && <p className="muted">{voice.notes}</p>}
    <div className="narration-actions">
      {voice.preview === 'local' && <button className="button" disabled={busy || !text.trim()} onClick={() => void listen()} aria-label={`Ouvir prévia de ${label}`}>{busy ? 'GERANDO PRÉVIA…' : 'OUVIR PRÉVIA'}</button>}
      {voice.preview === 'local' && canStop && <button className="button" type="button" onClick={stopPreview} aria-label={`Parar prévia de ${label}`}>PARAR PRÉVIA</button>}
      <button className="button" disabled={estimating || !text.trim()} onClick={() => void estimateCost()} aria-label={`Estimar custo de ${label}`}>{estimating ? 'ESTIMANDO…' : 'ESTIMAR CUSTO'}</button>
      <button className="button primary" aria-pressed={isDefault} onClick={onDefault} aria-label={`Usar ${label} como voz padrão`}>{isDefault ? 'VOZ PADRÃO' : 'USAR COMO PADRÃO'}</button>
    </div>
    {previewState !== 'idle' && (
      <p className={previewState === 'error' ? 'error' : 'muted'} role="status" aria-live="polite">
        Estado da prévia:{' '}
        {previewState === 'generating'
          ? 'gerando áudio…'
          : previewState === 'playing'
          ? 'tocando'
          : previewState === 'paused'
          ? 'pausada / parada'
          : 'erro na prévia'}
      </p>
    )}
    {voice.preview === 'requires_authorization' && <p className="muted">A prévia desta voz exige autorização por geração e custa créditos. Nenhuma chamada é feita aqui.</p>}
    {voice.preview === 'unavailable' && <p className="muted">Prévia indisponível para esta voz.</p>}
    {audio && (
      <audio
        ref={player}
        controls
        src={audio}
        aria-label={`Prévia de ${label}`}
        onPlay={() => setPreviewState('playing')}
        onPause={() => setPreviewState(prev => (prev === 'idle' ? 'idle' : 'paused'))}
        onEnded={() => setPreviewState('idle')}
        onError={() => {
          setPreviewState('error');
          setError('Não foi possível reproduzir o áudio da prévia.');
        }}
      />
    )}
    {estimate && <EstimateView estimate={estimate} />}
    {error && <p className="error" role="alert">{error}</p>}
  </li>;
}

// O estado vem de GET /v1/narration/providers: not_configured sem chave, blocked com chave (sem GET da credencial).

const credentialFromStatus = (status: ProviderStatus) => status === 'blocked' ? true : status === 'not_configured' ? false : null;

function ElevenLabsCredential({ connection, status }: { connection: Connection; status: ProviderStatus }) {
  const [saved, setConfigured] = useState<boolean | null>(null);
  const configured = saved ?? credentialFromStatus(status);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!key.trim() || busy) return;
    setBusy(true); setError('');
    const value = key; setKey('');
    try { setConfigured(await setElevenLabsCredential(connection, value)); } catch (reason) { setError(reasonText(reason)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError('');
    try { setConfigured(await removeElevenLabsCredential(connection)); } catch (reason) { setError(reasonText(reason)); } finally { setBusy(false); }
  }
  return <form className="narration-provider" aria-label="Conectar ElevenLabs" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h4>Conectar ElevenLabs</h4>
    <p className="muted" role="note">Conectar não habilita o uso pago nem consome créditos. A chave é enviada somente ao backend local, guardada no cofre do sistema e nunca é exibida de volta.</p>
    <p role="status">Chave: <strong>{configured === null ? 'estado indisponível (provedor desabilitado)' : configured ? 'configurada' : 'não configurada'}</strong></p>
    <label>Chave da API ElevenLabs<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="new-password" spellCheck={false} /></label>
    <div className="narration-actions">
      <button className="button primary" type="submit" disabled={busy || !key.trim()}>{configured ? 'SUBSTITUIR CHAVE' : 'SALVAR CHAVE'}</button>
      {configured && <button className="button" type="button" disabled={busy} onClick={() => void remove()}>REMOVER CHAVE</button>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function NarrationPanel({ connection }: { connection: Connection | null }) {
  const [providers, setProviders] = useState<NarrationProvider[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [language, setLanguage] = useState('');
  const [text, setText] = useState(DEFAULT_PREVIEW_TEXT);
  const [defaultVoice, setDefault] = useState<DefaultVoice | null>(null);
  const [defaultMessage, setDefaultMessage] = useState('');

  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    void Promise.all([getProviders(connection, controller.signal), getDefaultVoice(connection, controller.signal).catch(() => null)])
      .then(([list, current]) => {
        if (controller.signal.aborted) return;
        setProviders(list); setDefault(current);
        const languages = list.flatMap(p => p.voices.map(v => v.language));
        setLanguage(value => value || (languages.includes('pt-BR') ? 'pt-BR' : 'all'));
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reasonText(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connection, revision]);

  const languages = useMemo(() => {
    const all = Array.from(new Set((providers ?? []).flatMap(p => p.voices.map(v => v.language))));
    return all.sort((a, b) => (a === 'pt-BR' ? -1 : b === 'pt-BR' ? 1 : a.localeCompare(b)));
  }, [providers]);

  const chooseDefault = useCallback(async (provider: NarrationProvider, voice: NarrationVoice) => {
    if (!connection) return;
    setDefaultMessage('');
    try {
      const saved = await setDefaultVoice(connection, { provider: provider.id, voice_id: voice.id });
      setDefault(saved ?? { provider: provider.id, voice_id: voice.id });
      setDefaultMessage(`Voz padrão salva: ${voice.name} (${provider.name}).`);
    } catch (reason) { setDefaultMessage(`Não foi possível salvar a voz padrão: ${reasonText(reason)}`); }
  }, [connection]);

  if (!connection) return <section className="card" aria-label="Narração"><p className="eyebrow">NARRAÇÃO</p><h2>Conecte o backend local.</h2><p className="muted">Os provedores e as vozes são lidos do backend.</p></section>;
  const overLimit = text.length > PREVIEW_MAX_CHARS;
  return <div className="narration">
    <section className="card" aria-label="Narração">
      <p className="eyebrow">NARRAÇÃO</p><h2>Provedores e vozes.</h2>
      <p className="muted">A narração não depende de modelo de IA de texto. O alinhamento acústico e a revisão humana valem para qualquer provedor; provedores pagos ficam desabilitados até autorização explícita.</p>
      <label>Texto fictício da prévia ({text.length}/{PREVIEW_MAX_CHARS})
        <textarea value={text} maxLength={PREVIEW_MAX_CHARS} onChange={e => setText(e.target.value.slice(0, PREVIEW_MAX_CHARS))} aria-invalid={overLimit} /></label>
      <div className="narration-actions">
        <label>Idioma<select value={language} onChange={e => setLanguage(e.target.value)}>
          <option value="all">Todos</option>{languages.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
        <button className="button" disabled={loading} onClick={() => setRevision(v => v + 1)}>ATUALIZAR</button>
      </div>
      {(() => {
        if (!defaultVoice) {
          return (
            <p className="muted" role="status">
              Nenhuma voz padrão salva. Escolha uma voz abaixo com <strong>USAR COMO PADRÃO</strong> (sem preferência, o piloto local usa a primeira voz local disponível).
            </p>
          );
        }
        const matchedProvider = providers?.find(p => p.id === defaultVoice.provider);
        const matchedVoice = matchedProvider?.voices.find(v => v.id === defaultVoice.voice_id);
        const friendly = matchedVoice && matchedProvider
          ? `${matchedVoice.name} (${matchedProvider.name}) — `
          : '';
        return (
          <p role="status">
            <strong>Voz padrão atual:</strong> {friendly}{defaultVoice.provider} / {defaultVoice.voice_id}
          </p>
        );
      })()}
      {defaultMessage && <p role="status">{defaultMessage}</p>}
      {loading && <p role="status">Carregando provedores…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    {providers?.map(provider => {
      const status = STATUS[provider.status];
      const voices = provider.voices.filter(v => language === 'all' || v.language === language);
      return <section className="card narration-provider" key={provider.id} aria-label={`Provedor ${provider.name}`}>
        <div className="row spread"><h3>{provider.name}</h3>
          <span className="narration-actions"><span className="tag">{provider.kind === 'local' ? 'LOCAL' : 'API PAGA'}</span><span className={`tag ${status.tone}`}>{status.label}</span></span></div>
        <p className="muted">{provider.reason || 'Sem motivo informado.'}</p>
        <p className="muted">Licença do motor: <LicenseLink name={provider.engine_license.name} url={provider.engine_license.url} />{provider.engine_license.notes ? ` — ${provider.engine_license.notes}` : ''}</p>
        {provider.native_word_timestamps && <p className="muted">Este provedor entrega timestamps próprios. Eles são evidência adicional: o alinhamento acústico continua sendo a medição.</p>}
        {provider.requires_authorization && <p className="narration-warning" role="note">Uso pago: cada geração exige autorização explícita com o custo estimado. Prévias não são geradas sem autorização.</p>}
        {provider.id === 'elevenlabs' && <ElevenLabsCredential key={provider.status} connection={connection} status={provider.status} />}
        {voices.length === 0 ? <p className="muted">Nenhuma voz para o idioma selecionado.</p>
          : <ul aria-label={`Vozes de ${provider.name}`}>{voices.map(voice => <VoiceRow key={voice.id} connection={connection} provider={provider} voice={voice} text={text}
            isDefault={defaultVoice?.provider === provider.id && defaultVoice.voice_id === voice.id} onDefault={() => void chooseDefault(provider, voice)} />)}</ul>}
      </section>;
    })}
  </div>;
}

export default function NarrationSettings({ connection }: { connection: Connection | null }) {
  const [open, setOpen] = useState(false);
  if (!open) return <section className="card" aria-label="Narração"><p className="eyebrow">NARRAÇÃO</p><h2>Provedores e vozes.</h2><p className="muted">Escolha a voz padrão, ouça prévias locais e veja licenças e custo estimado. Nada é consultado até você abrir.</p><button className="button" onClick={() => setOpen(true)}>ABRIR NARRAÇÃO</button></section>;
  return <NarrationPanel connection={connection} />;
}
