import { describe, expect, it } from 'vitest';
import {
  normalizeHttpUrl,
  normalizePublishedAt,
  normalizeResearchSource,
  projectCitations,
  selectResearchSources,
} from './sources';

describe('research source normalization', () => {
  it('accepts only safe web URLs and removes fragments', () => {
    expect(normalizeHttpUrl(' https://example.com/a?q=1#section ')).toBe(
      'https://example.com/a?q=1',
    );
    expect(() => normalizeHttpUrl('ftp://example.com/file')).toThrow(/unsafe URL/);
    expect(() => normalizeHttpUrl('https://user:secret@example.com/')).toThrow(/unsafe URL/);
  });

  it('preserves honest date precision and rejects ambiguous timestamps', () => {
    expect(normalizePublishedAt('2026-09-30')).toBe('2026-09-30');
    expect(normalizePublishedAt('2026-02-30')).toBeNull();
    expect(normalizePublishedAt('2026-09-30T10:00:00-07:00')).toBe('2026-09-30T17:00:00.000Z');
    expect(normalizePublishedAt('2026-09-30T10:00:00')).toBeNull();
  });

  it('normalizes whitespace and limits evidence snippets', () => {
    const source = normalizeResearchSource(
      ' search-a ',
      {
        url: 'https://example.com',
        title: '  Example   company ',
        snippet: ` x ${'a'.repeat(3_000)} `,
      },
      '2026-09-30T00:00:00.000Z',
    );
    expect(source.provider).toBe('search-a');
    expect(source.title).toBe('Example company');
    expect(source.snippet).toHaveLength(2_000);
  });

  it('selects round-robin across providers while retaining provenance', () => {
    const selected = selectResearchSources(
      [
        {
          provider: 'a',
          hits: [
            { url: 'https://shared.example/item', title: 'A shared', snippet: 'a' },
            { url: 'https://a.example/second', title: 'A second', snippet: 'a2' },
          ],
        },
        {
          provider: 'b',
          hits: [
            { url: 'https://shared.example/item#top', title: 'B shared', snippet: 'b' },
            { url: 'https://b.example/second', title: 'B second', snippet: 'b2' },
          ],
        },
      ],
      4,
      '2026-09-30T00:00:00.000Z',
    );

    expect(selected.map((source) => `${source.provider}:${source.title}`)).toEqual([
      'a:A shared',
      'b:B shared',
      'a:A second',
      'b:B second',
    ]);
    expect(projectCitations(selected)).toEqual([
      { title: 'A shared', url: 'https://shared.example/item' },
      { title: 'A second', url: 'https://a.example/second' },
      { title: 'B second', url: 'https://b.example/second' },
    ]);
  });
});
