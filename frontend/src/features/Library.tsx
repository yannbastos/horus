import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { Connection, Media } from '../services/api';
import { nativeDesktop, selectDirectory, selectMedia } from '../platform/desktop';
import { SectionHeader, sections } from '../components/Sections';

export default function Library({ connection }: { connection: Connection | null }) {
  const [media, setMedia] = useState<Media[]>([]);
  const [playing, setPlaying] = useState<{ name: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const blob = useRef<string | null>(null);
  useEffect(() => {
    if (connection) void api<Media[]>(connection, '/v1/media').then(setMedia).catch(reason => setError(String(reason)));
    return () => { if (blob.current) URL.revokeObjectURL(blob.current); };
  }, [connection]);
  async function choose(folder = false) {
    setError('');
    if (!nativeDesktop) { input.current?.click(); return; }
    if (!connection) { setError('O backend local precisa estar disponível para registrar mídia.'); return; }
    try {
      const path = folder ? await selectDirectory() : await selectMedia();
      if (!path) return;
      await api(connection, folder ? '/v1/media/folder' : '/v1/media', { method: 'POST', body: JSON.stringify({ path }) });
      const list = await api<Media[]>(connection, '/v1/media');
      setMedia(list);
      if (!list.length) setError('Nenhum arquivo compatível encontrado nessa pasta.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <div className="page"><SectionHeader section={sections.library} />
    <div className="actions"><button className="button primary" onClick={() => void choose()}>SELECIONAR VÍDEO</button><button className="button" disabled={!nativeDesktop || !connection} onClick={() => void choose(true)}>ADICIONAR PASTA</button></div>
    <input ref={input} className="visually-hidden" type="file" accept="video/*,audio/*" aria-label="Selecionar mídia local" onChange={event => {
      const file = event.target.files?.[0]; if (!file) return;
      if (blob.current) URL.revokeObjectURL(blob.current);
      blob.current = URL.createObjectURL(file); setPlaying({ name: file.name, url: blob.current }); setError('');
    }} />
    {error && <p className="error" role="alert">{error}</p>}
    {playing && <section className="card player"><div className="row spread"><h3>{playing.name}</h3><button className="button" onClick={() => setPlaying(null)}>FECHAR PRÉVIA</button></div><video key={playing.url} controls preload="metadata" src={playing.url} onError={() => setError('Não foi possível reproduzir este formato. Tente um MP4 H.264/AAC ou WebM compatível.')} /></section>}
    {media.length ? <section className="media-list" aria-label="Arquivos registrados">{media.map(item => <button className="card media-item" key={item.id} onClick={() => { setError(''); setPlaying({ name: item.name, url: connection!.baseUrl + item.stream_path }); }}><strong>{item.name}</strong><span className="muted">{(item.size / 1024 / 1024).toFixed(1)} MB · Abrir prévia</span></button>)}</section>
      : <div className="empty-state"><span className="tag">ARQUIVOS LOCAIS</span><h2>Toda história começa com repertório.</h2><p className="muted">Selecione um vídeo para abrir a prévia. No desktop, arquivos registrados ficam disponíveis novamente após reiniciar.</p></div>}
  </div>;
}
