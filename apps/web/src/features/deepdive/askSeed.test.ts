import { describe, expect, it } from 'vitest';
import { cardAskSeed, contextBlock, digSeed, personAskSeed, present, sanitizeSeed } from './askSeed';

const LEAK = /\b(?:null|undefined)\b|:\s*unknown|\(\s*\)|""/i;

describe('ask seeds never carry empty data', () => {
  it('present drops blanks and placeholders', () => {
    for (const v of [null, undefined, '', '  ', 'Unknown', 'N/A', 'null', 'undefined', 'Not reported', '-']) {
      expect(present(v)).toBeNull();
    }
    expect(present('  CTO  ')).toBe('CTO');
  });

  it('a card with no title does not ask about "null"', () => {
    expect(cardAskSeed(null)).toBeNull();
    expect(cardAskSeed('  ')).toBeNull();
    expect(cardAskSeed('Cohere')).toBe('Dig into "Cohere": what\'s the full picture?');
  });

  it('a thin person profile asks from the web instead of listing Unknowns', () => {
    const seed = personAskSeed({ name: 'Jane Doe', role: '', company: 'Acme', tenure: 'Unknown', bio: 'N/A' });
    expect(seed).toContain('Research Jane Doe at Acme');
    expect(seed).toContain('Little is on file');
    expect(seed).not.toMatch(LEAK);
    expect(seed).not.toMatch(/Role:|Tenure:|Prior company:/);
  });

  it('a fuller profile pins only the fields that exist', () => {
    const seed = personAskSeed({ name: 'Jane Doe', role: 'CTO', company: 'Acme', tenure: '2019 to now', priorCompany: null, notableProject: 'Atlas', bio: '' });
    expect(seed).toContain('Jane Doe (CTO) at Acme');
    expect(seed).toContain('Tenure: 2019 to now');
    expect(seed).toContain('Notable project: Atlas');
    expect(seed).not.toMatch(/Prior company|Reported background/);
    expect(seed).not.toMatch(LEAK);
  });

  it('a dig-deeper topic leaves out a missing context or company', () => {
    expect(digSeed({ topic: 'Funding history', context: null, companyName: '' })).toBe('Funding history');
    expect(digSeed({ topic: 'Funding history', context: 'Series B', companyName: 'Acme' })).toBe('Funding history: Series B (for Acme)');
    expect(digSeed({ topic: '  ' })).toBeNull();
  });

  it('sanitizeSeed removes leaked placeholders and returns null when nothing is left', () => {
    expect(sanitizeSeed('Milestone in Acme: "Series A" (null). Tell the story.')).toBe('Milestone in Acme: "Series A". Tell the story.');
    expect(sanitizeSeed('Tenure: Unknown\nRole:')).toBeNull();
    expect(sanitizeSeed('null')).toBeNull();
    expect(sanitizeSeed(undefined)).toBeNull();
  });

  it('contextBlock keeps only fields that hold something', () => {
    expect(contextBlock([['A', 'x'], ['B', 'Unknown'], ['C', null]])).toBe('A: x');
  });
});
