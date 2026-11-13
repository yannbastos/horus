import { expect, test } from '@playwright/test';
import { describeVoiceAssets } from '../src/services/production';

// J-16: o rótulo da voz vem da proveniência (origin + narration), nunca fixo em "SAPI".
test.describe('HOR-087 J-16: rótulo de voz derivado da proveniência', () => {
  test('system_voice vira voz do Windows', () => {
    expect(describeVoiceAssets([{ origin: 'system_voice', license: 'unverified' }])).toBe(
      'voz do Windows'
    );
  });

  test('local_tts_model mostra provedor e voz (Kokoro pf_dora)', () => {
    expect(
      describeVoiceAssets([
        {
          origin: 'local_tts_model',
          narration: { engine: 'kokoro', voice: 'pf_dora', voice_id: 'pf_dora' },
        },
      ])
    ).toBe('Kokoro pf_dora');
  });

  test('ignora assets que não são voz e não repete rótulos', () => {
    expect(
      describeVoiceAssets([
        { origin: 'original_local' },
        { origin: 'local_tts_model', narration: { engine: 'kokoro', voice: 'pf_dora' } },
        { origin: 'local_tts_model', narration: { engine: 'kokoro', voice: 'pf_dora' } },
      ])
    ).toBe('Kokoro pf_dora');
    expect(describeVoiceAssets([{ origin: 'original_local' }])).toBe('voz local');
  });
});
