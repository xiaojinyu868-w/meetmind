import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCases, summarize, summarizeByTag, type AsrEvalResult } from './runner';

describe('ASR runner dataset modes', () => {
  it('keeps text pins in dry mode and real audio cases in real mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meetmind-asr-eval-'));
    writeFileSync(join(dir, 'cases.jsonl'), [
      JSON.stringify({ id: 'dry', reference: '课堂', hypothesis: '课堂' }),
      JSON.stringify({ id: 'real', reference: '课堂', audio: 'fixture.wav', audioDurationMs: 1000 }),
    ].join('\n'));

    expect(loadCases(dir, undefined, 'dry').map((item) => item.id)).toEqual(['dry']);
    expect(loadCases(dir, undefined, 'real').map((item) => item.id)).toEqual(['real']);
  });
});

describe('ASR runner summaries', () => {
  const results: AsrEvalResult[] = [
    {
      id: 'clean', reference: 'a', hypothesis: 'a',
      cer: { cer: 0, substitutions: 0, deletions: 0, insertions: 0, referenceLength: 1, hypothesisLength: 1, editDistance: 0 },
      durationMs: 500, audioDurationMs: 1000, realTimeFactor: 0.5, tags: ['clean'],
      diarization: {
        der: 0.1, missedSpeechMs: 100, falseAlarmMs: 0, confusionMs: 0,
        referenceSpeechMs: 1000, referenceSpeakerCount: 2, hypothesisSpeakerCount: 2,
        speakerCountError: 0, mapping: { '0': 'teacher', '1': 'student' },
      },
    },
    {
      id: 'noisy', reference: 'a', hypothesis: '',
      cer: { cer: 1, substitutions: 0, deletions: 1, insertions: 0, referenceLength: 1, hypothesisLength: 0, editDistance: 1 },
      durationMs: 250, audioDurationMs: 1000, realTimeFactor: 0.25, tags: ['noise-5db'],
    },
  ];

  it('reports API latency and real-time factor', () => {
    expect(summarize(results)).toMatchObject({
      count: 2,
      avgCer: 0.5,
      avgDurationMs: 375,
      avgRealTimeFactor: 0.375,
      avgDer: 0.1,
      diarizationCases: 1,
      failed: 1,
    });
  });

  it('aggregates quality by noise tag', () => {
    expect(summarizeByTag(results)['noise-5db']).toMatchObject({ count: 1, avgCer: 1 });
  });
});
