import { afterEach, describe, expect, it, vi } from 'vitest';
import { retrieveExternalCandidates, scoreSource } from './feed-retrieval-service';

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
    }]);

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
});
