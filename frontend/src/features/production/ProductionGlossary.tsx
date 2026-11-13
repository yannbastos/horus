// J-08: termos internos em linguagem simples; o valor técnico continua visível para auditoria.
export const GLOSSARY: Record<string, { label: string; hint: string }> = {
  publishable: {
    label: 'Não publicável',
    hint: 'O vídeo ainda não pode ser publicado: faltam licenças verificadas e a decisão de publicação não foi tomada. A aprovação técnica nunca muda isso.',
  },
  demo_only: {
    label: 'Somente demonstração',
    hint: 'É um teste técnico do processo; não é um vídeo final para o público.',
  },
  real_voice: {
    label: 'Voz humana real',
    hint: 'Indica se a narração é de uma pessoa. Falso significa voz sintética gerada no computador, nunca voz humana nem clone.',
  },
  speech_aligned: {
    label: 'Legenda sincronizada com a fala',
    hint: 'Indica se cada palavra da legenda foi alinhada ao instante exato em que é falada. Falso significa que a sincronia é aproximada, por trecho.',
  },
  sha256: {
    label: 'Impressão digital (SHA-256)',
    hint: 'Código de 64 caracteres que identifica exatamente o conteúdo de um arquivo; se o arquivo mudar, o código muda. A aprovação fica presa a ele.',
  },
};

export function termTitle(term: keyof typeof GLOSSARY): string {
  const entry = GLOSSARY[term];
  return `${entry.label}: ${entry.hint}`;
}

export default function ProductionGlossary() {
  return (
    <details aria-label="Glossário dos termos técnicos">
      <summary>O que significam estes termos?</summary>
      <dl style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0 0' }}>
        {Object.entries(GLOSSARY).map(([term, entry]) => (
          <div key={term}>
            <dt>
              <strong>{entry.label}</strong> <code>{term}</code>
            </dt>
            <dd className="muted" style={{ margin: 0 }}>
              {entry.hint}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
