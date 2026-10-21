import { createRequire } from 'node:module';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';

// pptxgenjs ships its own zip library; use that one to open what it wrote.
const requireFromHere = createRequire(import.meta.url);
const JSZip = createRequire(requireFromHere.resolve('pptxgenjs'))('jszip') as {
  loadAsync(data: Buffer): Promise<{ files: Record<string, unknown>; file(name: string): { async(kind: 'string'): Promise<string> } }>;
};

const written = vi.hoisted(() => ({ buffer: null as Buffer | null }));
// Keep the real builder, but hand back the bytes instead of starting a download.
vi.mock('pptxgenjs', async () => {
  const real = await vi.importActual<{ default: new () => { write(opts: { outputType: string }): Promise<Buffer> } }>('pptxgenjs');
  class Capturing extends real.default {
    async writeFile() { written.buffer = await this.write({ outputType: 'nodebuffer' }); }
  }
  return { default: Capturing };
});

/** Every character XML 1.0 forbids in text, other than lone surrogates. */
const ILLEGAL: string[] = [];
for (let code = 0x00; code <= 0x08; code += 1) ILLEGAL.push(String.fromCharCode(code));
ILLEGAL.push('\u000B', '\u000C');
for (let code = 0x0e; code <= 0x1f; code += 1) ILLEGAL.push(String.fromCharCode(code));
ILLEGAL.push('\uFFFE', '\uFFFF');

function entityCard(name: string, over: { oneLiner?: string; hq?: string; primary?: string; sourceTitle?: string; sourceUrl?: string } = {}): CardWithCompany {
  return {
    card: { id: `k-${name.length}`, deckId: 'd', companyId: 'c', cardType: 'company', title: name, summary: null, tier: null, tierReason: null, citations: [], keyPoints: [], createdAt: '' },
    company: {
      id: 'c', name, oneLiner: over.oneLiner ?? 'Makes anvils.', hqLocation: over.hq ?? 'Austin, Texas', websiteUrl: null, logoUrl: null,
      brandTheme: over.primary ? { primary: over.primary } : null,
    },
    metrics: [{
      id: 'm1', companyId: 'c', metricType: 'arr', value: 5_000_000, confidence: 'verified', source: null,
      citations: [{ url: over.sourceUrl ?? 'https://www.sec.gov/x', title: over.sourceTitle ?? 'SEC filing' }],
      methodNote: null, capturedAt: '2026-01-01T00:00:00Z',
    }],
    viceClaims: [],
  } as unknown as CardWithCompany;
}

/** Build a deck and return every XML part of the .pptx, keyed by file name. */
async function buildAndRead(args: { marketName?: string; thesis?: string | null; cards: CardWithCompany[] }): Promise<Record<string, string>> {
  const { exportDeckPptx } = await import('./pptx');
  await exportDeckPptx({ marketName: args.marketName ?? 'Anvils', cards: args.cards, thesis: args.thesis });
  const zip = await JSZip.loadAsync(written.buffer!);
  const parts: Record<string, string> = {};
  for (const name of Object.keys(zip.files).filter((n) => /\.(xml|rels)$/.test(n))) parts[name] = await zip.file(name).async('string');
  return parts;
}

/** Office refuses a part that is not well-formed XML; a parser stands in for it. */
function malformedParts(parts: Record<string, string>): string[] {
  const parser = new DOMParser();
  return Object.entries(parts)
    .filter(([, xml]) => parser.parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length > 0)
    .map(([name]) => name);
}

describe('xmlSafe', () => {
  it('removes what XML cannot carry and keeps what it can', async () => {
    const { xmlSafe } = await import('./pptx');
    expect(xmlSafe('a\u0000b\u0008c\u000ed\u001fe\uFFFEf\uFFFFg')).toBe('abcdefg');
    expect(xmlSafe('a\u000bb\u000cc')).toBe('a b c');
    expect(xmlSafe('tab\there\nnew\rline')).toBe('tab\there\nnew\rline');
    expect(xmlSafe('Zürich 東京 🚀 — “quoted”')).toBe('Zürich 東京 🚀 — “quoted”');
    expect(xmlSafe('lone\ud800 and \udc00 gone, pair 🚀 kept')).toBe('lone and  gone, pair 🚀 kept');
  }, 60_000);
});

describe('the PowerPoint export', () => {
  // The first import loads the whole presentation library, which is slow on a busy machine.
  beforeAll(async () => { await import('./pptx'); }, 60_000);
  beforeEach(() => { written.buffer = null; });

  it('is well-formed XML throughout for ordinary text', async () => {
    const parts = await buildAndRead({ cards: [entityCard('Acme & <Sons> "Inc"')], thesis: 'A **gap** in the market.' });
    expect(Object.keys(parts)).toContain('ppt/slides/slide1.xml');
    expect(malformedParts(parts)).toEqual([]);
    expect(Object.values(parts).join('\n')).toContain('Acme &amp; &lt;Sons&gt;');
  });

  it('writes a deck that opens when names, one-liners, titles, sources and the thesis carry characters XML forbids', async () => {
    const junk = ILLEGAL.join('');
    const parts = await buildAndRead({
      marketName: `Market${junk}Name`,
      thesis: `Gap${junk}here`,
      cards: [entityCard(`Acme${junk}Inc`, { oneLiner: `One${junk}liner`, hq: `Aus${junk}tin`, sourceTitle: `Wire${junk}Service` })],
    });
    expect(malformedParts(parts)).toEqual([]);
    const text = Object.values(parts).join('\n');
    // The words survive; the unwritable characters are gone (the two that are
    // whitespace, vertical tab and form feed, leave a space between the words).
    for (const words of [/Market\s+Name/, /Gap\s+here/, /Acme\s+Inc/, /One\s+liner/, /Aus\s+tin/, /Wire\s+Service/]) expect(text).toMatch(words);
  });

  it('survives each forbidden character on its own, form feed from copied PDF text included', async () => {
    for (const ch of ILLEGAL) {
      const parts = await buildAndRead({ cards: [entityCard(`Acme${ch}Inc`)] });
      expect(malformedParts(parts), `U+${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).toEqual([]);
    }
  }, 60_000);

  it('keeps a form feed between words readable', async () => {
    const parts = await buildAndRead({ cards: [entityCard('Acme\fHoldings')] });
    expect(malformedParts(parts)).toEqual([]);
    expect(Object.values(parts).join('\n')).toContain('Acme Holdings');
  });

  it('drops a lone surrogate, which cannot be written as UTF-8', async () => {
    const parts = await buildAndRead({ cards: [entityCard('Acme\ud800Inc', { oneLiner: 'Half\udc00pair' })] });
    expect(malformedParts(parts)).toEqual([]);
  });

  it('keeps a source link that carries a control character well-formed', async () => {
    const parts = await buildAndRead({ cards: [entityCard('Acme', { sourceUrl: 'https://a.example/x\u0001y\u000cz?q="1"&r=<2>' })] });
    expect(malformedParts(parts)).toEqual([]);
  });

  it('cannot be made to write markup through a brand colour', async () => {
    const parts = await buildAndRead({ cards: [entityCard('Acme', { primary: '#F00"/></a:solidFill><a:evil x="1' })] });
    expect(malformedParts(parts)).toEqual([]);
    expect(Object.values(parts).join('\n')).not.toMatch(/<a:evil/);
  });
});
