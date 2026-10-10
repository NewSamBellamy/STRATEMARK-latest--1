import { describe, it, expect } from 'vitest';
import { assertCapturable, CaptureError, type CaptureReceipt } from '../lib/capture';
import { zodToGenAiSchema } from '@mi/research';
import {
  VISION_BLOCK_KINDS,
  parseVisionVerdict,
  verifyBySignature,
  verifyCapture,
  visionVerdictSchema,
} from '../lib/verify';
import { renderFallbackCard, fallbackCaption } from '../lib/fallback';

function receipt(over: Partial<CaptureReceipt> = {}): CaptureReceipt {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    httpStatus: 200,
    title: 'Example',
    contentHash: 'a'.repeat(64),
    capturedAt: '2026-08-27T14:22:00.000Z',
    durationMs: 900,
    ...over,
  };
}

const REAL_TEXT = 'We build competitive intelligence tooling for teams. '.repeat(6);

describe('assertCapturable — the capture endpoint takes a URL from the caller', () => {
  it('accepts ordinary public http and https URLs', () => {
    expect(assertCapturable('https://example.com/pricing').hostname).toBe('example.com');
    expect(assertCapturable('http://example.com').protocol).toBe('http:');
  });

  it.each([
    ['file:///etc/passwd', 'non-http scheme'],
    ['http://localhost:3000', 'localhost'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://10.1.2.3/', 'private range'],
    ['http://192.168.0.5/', 'private range'],
    ['http://172.16.9.9/', 'private range'],
    ['http://169.254.169.254/computeMetadata/v1/', 'GCP metadata server'],
    ['http://metadata.google.internal/', 'GCP metadata host'],
  ])('refuses %s (%s)', (url) => {
    expect(() => assertCapturable(url)).toThrow(CaptureError);
  });

  it('rejects malformed input rather than passing it to a browser', () => {
    expect(() => assertCapturable('not a url')).toThrow(/Not a valid URL/);
  });

  it('honours an operator-supplied blocklist', () => {
    expect(() => assertCapturable('https://blocked.test/', ['blocked.test'])).toThrow(/Refusing/);
  });
});

describe('verifyBySignature — the free stage', () => {
  it('treats a 403 as blocked', () => {
    const v = verifyBySignature(receipt({ httpStatus: 403 }), REAL_TEXT);
    expect(v).toMatchObject({ isRealPage: false, blockKind: 'forbidden' });
  });

  it('treats a 429 as rate limited, not as content', () => {
    expect(verifyBySignature(receipt({ httpStatus: 429 }), REAL_TEXT)?.blockKind).toBe('rate_limited');
  });

  it('treats 5xx as an error page', () => {
    expect(verifyBySignature(receipt({ httpStatus: 503 }), REAL_TEXT)?.blockKind).toBe('error_page');
  });

  it('recognises a Cloudflare interstitial that returned 200', () => {
    const v = verifyBySignature(receipt({ title: 'Just a moment...' }), 'Checking your browser before accessing.');
    expect(v).toMatchObject({ isRealPage: false, blockKind: 'cloudflare' });
  });

  it('recognises a CAPTCHA challenge', () => {
    const v = verifyBySignature(receipt(), `Verify you are human. ${REAL_TEXT}`);
    expect(v?.blockKind).toBe('captcha');
  });

  it('passes a genuine page with real content', () => {
    const v = verifyBySignature(receipt(), REAL_TEXT);
    expect(v).toMatchObject({ isRealPage: true, blockKind: null, decidedBy: 'signature' });
  });

  it('defers to vision when there is too little text to judge', () => {
    expect(verifyBySignature(receipt(), 'Hello')).toBeNull();
  });
});

describe('verifyCapture — escalation and failing closed', () => {
  it('never spends a vision call on a case signatures already settled', async () => {
    let called = 0;
    const v = await verifyCapture({
      receipt: receipt({ httpStatus: 403 }),
      text: REAL_TEXT,
      screenshot: Buffer.alloc(0),
      vision: async () => {
        called += 1;
        return '{}';
      },
    });
    expect(called).toBe(0);
    expect(v.decidedBy).toBe('signature');
  });

  it('escalates an ambiguous capture to vision', async () => {
    const v = await verifyCapture({
      receipt: receipt(),
      text: 'tiny',
      screenshot: Buffer.alloc(0),
      vision: async () => '{"isRealPage":true,"blockKind":null,"confidence":0.9,"evidence":"A product landing page."}',
    });
    expect(v).toMatchObject({ isRealPage: true, decidedBy: 'vision', confidence: 0.9 });
  });

  it('fails closed when ambiguous and no vision judge exists', async () => {
    const v = await verifyCapture({ receipt: receipt(), text: 'tiny', screenshot: Buffer.alloc(0) });
    // An unverifiable capture must not be reported as genuine.
    expect(v.isRealPage).toBe(false);
  });

  it('fails closed when the vision call itself throws', async () => {
    const v = await verifyCapture({
      receipt: receipt(),
      text: 'tiny',
      screenshot: Buffer.alloc(0),
      vision: async () => {
        throw new Error('quota exhausted');
      },
    });
    expect(v.isRealPage).toBe(false);
    expect(v.evidence).toMatch(/quota exhausted/);
  });
});

describe('parseVisionVerdict', () => {
  it('reads JSON wrapped in prose', () => {
    const v = parseVisionVerdict('Sure!\n{"isRealPage":false,"blockKind":"captcha","confidence":0.88,"evidence":"A checkbox challenge."}\nHope that helps');
    expect(v).toMatchObject({ isRealPage: false, blockKind: 'captcha', confidence: 0.88 });
  });

  it('treats unparseable output as not-a-real-page', () => {
    expect(parseVisionVerdict('I cannot tell').isRealPage).toBe(false);
  });

  it('always names a block kind when the page is not real, so the report can explain itself', () => {
    expect(parseVisionVerdict('{"isRealPage":false}').blockKind).toBe('empty');
  });

  it('rejects a hallucinated block kind outside the known set', () => {
    expect(parseVisionVerdict('{"isRealPage":false,"blockKind":"alien_invasion"}').blockKind).toBe('empty');
  });

  // ------------------------------------------------------------------------
  // Strict agent output — issue #48
  // ------------------------------------------------------------------------

  const valid = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      isRealPage: true,
      blockKind: null,
      confidence: 0.9,
      evidence: 'A product landing page with pricing.',
      ...over,
    });

  it('accepts a verdict that conforms to the contract', () => {
    const v = parseVisionVerdict(valid());
    expect(v).toMatchObject({ isRealPage: true, blockKind: null, confidence: 0.9 });
    expect(v.evidence).toBe('A product landing page with pricing.');
  });

  it('refuses an out-of-range confidence instead of reading it as certainty', () => {
    // Clamping 7 to 1.0 turned malformed output into MAXIMUM confidence — the
    // worst possible reading. Out of range means the model did not follow the
    // contract, so the capture is unverified and we fail closed.
    const v = parseVisionVerdict(valid({ confidence: 7 }));
    expect(v.isRealPage).toBe(false);
    expect(v.confidence).toBe(0); // the fail-closed sentinel, not a clamp
    expect(v.evidence).toMatch(/did not match/i);
  });

  it('invents no confidence figure for output it could not read', () => {
    // The old parser returned 0.5 for unparseable output: a plausible-looking
    // number standing in for no information at all.
    const v = parseVisionVerdict('the screenshot seems fine to me');
    expect(v.isRealPage).toBe(false);
    expect(v.confidence).not.toBe(0.5);
    expect(v.evidence).toMatch(/did not match|could not/i);
  });

  it('does not trust a verdict that states no evidence', () => {
    // `evidence` is printed in the report as the reason. A verdict with none is
    // unusable, so it must not pass as a real page.
    const v = parseVisionVerdict('{"isRealPage":true,"confidence":0.95}');
    expect(v.isRealPage).toBe(false);
  });

  it('rejects a non-boolean isRealPage rather than coercing it', () => {
    expect(parseVisionVerdict(valid({ isRealPage: 'yes' })).isRealPage).toBe(false);
  });
});

describe('the vision contract handed to the model (issue #48)', () => {
  it('constrains blockKind to the known set in the native response schema', () => {
    const schema = zodToGenAiSchema(visionVerdictSchema);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.blockKind!.enum).toEqual([...VISION_BLOCK_KINDS]);
    expect(props.isRealPage!.type).toBe('BOOLEAN');
  });

  it('requires the model to state its evidence', () => {
    const schema = zodToGenAiSchema(visionVerdictSchema);
    expect(schema.required as string[]).toContain('evidence');
  });
});

describe('fallback card', () => {
  const verdict = { isRealPage: false, blockKind: 'captcha' as const, confidence: 0.9, evidence: 'A CAPTCHA checkbox is shown.', decidedBy: 'vision' as const };

  it('carries the proof of visit, not just an apology', () => {
    const svg = renderFallbackCard({ receipt: receipt({ httpStatus: 403 }), verdict });
    expect(svg).toContain('PROOF OF VISIT');
    expect(svg).toContain('HTTP 403');
    expect(svg).toContain('example.com');
    expect(svg).toContain('2026-08-27 14:22 UTC');
  });

  it('escapes hostile content so a page title cannot inject markup', () => {
    const svg = renderFallbackCard({
      receipt: receipt({ title: '<script>alert(1)</script>' }),
      verdict,
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('renders valid standalone SVG', () => {
    const svg = renderFallbackCard({ receipt: receipt(), verdict });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('says plainly that the image is not of the page', () => {
    expect(fallbackCaption(verdict)).toMatch(/not from the page/);
  });
});
