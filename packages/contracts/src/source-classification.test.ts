import { describe, expect, it } from 'vitest';
import { classifySource } from './provenance';

describe('source classification domain boundaries', () => {
  it('does not trust publisher names in arbitrary page titles or URLs', () => {
    expect(classifySource('https://example.com/?source=sec.gov', 'Reuters financial report')).toBe('unknown');
    expect(classifySource('https://reuters.com.attacker.test/report')).toBe('unknown');
    expect(classifySource('https://notsec.gov/report')).toBe('unknown');
  });
  it('recognizes primary sources and validated company domains', () => {
    expect(classifySource('https://www.sec.gov/Archives/report')).toBe('primary');
    expect(classifySource('https://investors.example.com/report', null, 'https://example.com')).toBe('primary');
    expect(classifySource('https://example.com.attacker.test/report', null, 'https://example.com')).toBe('unknown');
    expect(classifySource('https://www.tradingview.com/report')).toBe('industry');
  });
  it('handles opaque grounding metadata conservatively', () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/test';
    expect(classifySource(redirect, 'reuters.com')).toBe('reputable_secondary');
    expect(classifySource(redirect, 'Reuters says revenue grew')).toBe('unknown');
    expect(classifySource('https://reddit.com/r/investing', 'SEC filing')).toBe('user_generated');
  });
});
