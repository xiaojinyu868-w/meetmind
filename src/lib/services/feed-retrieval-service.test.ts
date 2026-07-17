import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrieveExternalCandidates, scoreSource, selectDashScopeSearchSources } from './feed-retrieval-service';
import { webSearchExact } from './web-search-service';

vi.mock('./web-search-service', () => ({
  webSearchExact: vi.fn(async () => [
    { id: 'web-1', title: 'University research guide', url: 'https://example.edu/research', snippet: 'A grounded research guide.', source_type: 'web' },
    { id: 'web-2', title: 'Public research report', url: 'https://example.org/report', snippet: 'A public-interest report.', source_type: 'web' },
  ]),
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('feed external retrieval source quality', () => {
  it('keeps real search sources when the model returns unmatched source indexes', () => {
    const sources = [
      { index: 1, title: 'Grounded result', url: 'https://example.edu/source' },
    ];
    expect(selectDashScopeSearchSources(sources, [{ index: 99, summary: 'unmatched' }]))
      .toEqual(sources);
  });

  it('gives scholarly and public-interest sources a stronger prior', () => {
    expect(scoreSource('https://arxiv.org/abs/2401.00001'))
      .toBeGreaterThan(scoreSource('https://example.com/post'));
    expect(scoreSource('https://openlibrary.org/works/OL123W'))
      .toBeGreaterThan(scoreSource('https://example.com/book-list'));
    expect(scoreSource('https://example.edu/research/report.pdf'))
      .toBeGreaterThan(scoreSource('https://example.com/report'));
  });

  it('merges real web, paper, and book records with provenance metadata', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('semanticscholar.org')) {
        return new Response(JSON.stringify({ data: [{
          title: 'Retrieval Practice in Learning',
          url: 'https://www.semanticscholar.org/paper/real-paper',
          abstract: 'A study of retrieval practice and long-term learning.',
          authors: [{ name: 'A. Researcher' }],
          year: 2025,
          venue: 'Learning Science',
          citationCount: 12,
        }] }), { status: 200 });
      }
      if (url.includes('openlibrary.org')) {
        return new Response(JSON.stringify({ docs: [{
          key: '/works/OL123W',
          title: 'How Learning Works',
          author_name: ['S. Scholar'],
          first_publish_year: 2020,
          subject: ['Learning'],
          edition_count: 4,
        }] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const candidates = await retrieveExternalCandidates([{
      query: 'retrieval practice learning',
      academicQuery: 'retrieval practice long-term learning',
      bookQuery: 'learning science retrieval practice',
      reason: '与你的学习科学笔记相关',
      perspective: 'counterpoint',
      contentKinds: ['web', 'paper', 'book'],
      sourceCaptureIds: ['capture-1'],
    }], { strategy: 'direct' });

    expect(candidates.map((candidate) => candidate.contentKind)).toEqual(
      expect.arrayContaining(['web', 'paper', 'book']),
    );
    expect(candidates.find((candidate) => candidate.contentKind === 'paper')).toMatchObject({
      authors: ['A. Researcher'],
      publishedAt: '2025',
      discovery: { perspective: 'counterpoint' },
    });
    expect(candidates.find((candidate) => candidate.contentKind === 'book')?.url)
      .toBe('https://openlibrary.org/works/OL123W');
  });

  it('uses DashScope native search results without calling blocked global search providers', async () => {
    vi.mocked(webSearchExact).mockClear();
    const searchEvents = [
      'data:{"output":{"choices":[{"message":{"content":""},"finish_reason":"null"}],"search_info":{"search_results":[{"site_name":"OpenAI Spinning Up","index":1,"title":"Introduction to RL","url":"https://spinningup.openai.com/en/latest/spinningup/rl_intro.html"},{"site_name":"UCL","index":2,"title":"Bellman Equations","url":"https://www0.cs.ucl.ac.uk/staff/d.silver/web/Teaching_files/L3_Value_Functions.pdf"}]}}}',
      'data:{"output":{"choices":[{"message":{"content":"{\\"items\\":[{\\"index\\":1,\\"summary\\":\\"A grounded reinforcement-learning introduction.\\"},{\\"index\\":2,\\"summary\\":\\"A lecture on value functions and Bellman equations.\\"}]}"},"finish_reason":"stop"}],"search_info":{"search_results":[]}}}',
    ].join('\n\n');
    globalThis.fetch = vi.fn(async () => new Response(searchEvents, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as typeof fetch;

    const candidates = await retrieveExternalCandidates([{
      query: 'reinforcement learning Bellman equation introduction',
      reason: '补齐当前强化学习课程的概念基础',
      perspective: 'deepen',
      contentKinds: ['web'],
      sourceCaptureIds: ['capture-rl'],
    }], {
      strategy: 'dashscope',
      dashscopeApiKey: 'test-key',
    });

    expect(webSearchExact).not.toHaveBeenCalled();
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      title: 'Introduction to RL',
      snippet: 'A grounded reinforcement-learning introduction.',
      sourceLabel: 'OpenAI Spinning Up',
      preRanked: true,
      retrievalProvider: 'dashscope-search',
    });
  });
});
