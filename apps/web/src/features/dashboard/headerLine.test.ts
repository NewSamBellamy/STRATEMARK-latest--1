import { describe, expect, it } from 'vitest';
import { headerLine } from './headerLine';

describe('headerLine', () => {
  it('keeps a short line whole and drops the final stop', () => {
    expect(headerLine('Stripe builds payments infrastructure for the internet.')).toBe('Stripe builds payments infrastructure for the internet');
  });

  it('uses only the first sentence', () => {
    expect(headerLine('Cohere builds enterprise AI. It was founded in Toronto in 2019.')).toBe('Cohere builds enterprise AI');
  });

  it('cuts a long sentence at a natural break and marks the cut', () => {
    const line = headerLine('OpenAI is an artificial intelligence research and deployment company focused on developing safe and beneficial artificial general intelligence.');
    expect(line.length).toBeLessThanOrEqual(100);
    expect(line.endsWith('…')).toBe(true);
    expect(line).toBe('OpenAI is an artificial intelligence research and deployment company…');
  });

  it('falls back to a word boundary when there is no break', () => {
    const line = headerLine('A'.repeat(0) + 'word '.repeat(40));
    expect(line.length).toBeLessThanOrEqual(100);
    expect(line.endsWith('…')).toBe(true);
  });

  it('is empty for nothing', () => {
    expect(headerLine(null)).toBe('');
    expect(headerLine('   ')).toBe('');
  });
});
