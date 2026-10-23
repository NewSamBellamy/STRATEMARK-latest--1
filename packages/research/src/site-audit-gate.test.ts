import { describe, expect, it } from 'vitest';
import type { SiteAuditV2Out } from './schemas';
import { composeSiteAudit, quoteSource, scoreConfidence, siteAuditMarkdown } from './site-audit-gate';
import { classifyAuditPage, extractAuditEvidence } from './site-audit-evidence';
import { RUBRIC, runChecklist, scoreCeiling, scoreFromChecks, buildAuditPrompt } from './site-audit-rubric';

const PAGE = `<!doctype html><html lang="en"><head><title>Acme Billing - Invoice customers in two clicks</title>
<meta name="description" content="Acme sends, tracks and reconciles invoices so finance teams stop chasing payments every month.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://acme.test/"></head>
<body><nav><a href="/pricing">Pricing</a></nav>
<h1>Get paid faster without chasing invoices</h1>
<p>Acme reconciles every payment automatically, so finance closes the month three days sooner than before.</p>
<a class="btn" href="/signup">Start free trial</a><a class="btn" href="/demo">Book a demo</a>
<h2>Trusted by finance teams</h2><p>Rated 4.8/5 on G2 by 1,200 reviewers. 30-day money-back guarantee.</p>
<img src="a.png" alt="Globex logo"><p>${'We help finance teams collect cash and close the books with fewer manual steps. '.repeat(4)}</p>
</body></html>`;

const evidence = extractAuditEvidence(PAGE, 'https://acme.test/');
const checklist = runChecklist(evidence);

function out(over: Partial<SiteAuditV2Out> = {}): SiteAuditV2Out {
  return { criteria: [], fixes: [], testFirst: [], designSummary: '', designQuote: null, designNotes: [], ...over };
}

const compose = (o: SiteAuditV2Out, extra: Partial<Parameters<typeof composeSiteAudit>[0]> = {}) =>
  composeSiteAudit({
    url: 'https://acme.test/', siteName: 'Acme', evidence, pageStatus: 'read', checklist, groundedText: 'Customers call Acme "the invoice chaser killer" in reviews.',
    groundedOk: true, out: o, ...extra,
  });

describe('rubric', () => {
  it('weights sum to 100 and every category states 2/5/8 anchors', () => {
    expect(RUBRIC.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(new Set(RUBRIC.map((c) => c.area)).size).toBe(RUBRIC.length);
    for (const c of RUBRIC) {
      expect(c.anchors.low.startsWith('2 =')).toBe(true);
      expect(c.anchors.mid.startsWith('5 =')).toBe(true);
      expect(c.anchors.high.startsWith('8 =')).toBe(true);
    }
  });
});

describe('runChecklist', () => {
  it('is all-unknown, with the reason, when the page was not read', () => {
    const none = runChecklist(null, 'Blocked by a bot check.');
    expect(none.every((c) => c.status === 'unknown' && c.detail === 'Blocked by a bot check.')).toBe(true);
  });

  it('decides each check from page facts', () => {
    const by = (id: string) => checklist.find((c) => c.id === id)!;
    expect(by('one_h1').status).toBe('pass');
    expect(by('cta_in_opening').status).toBe('pass');
    expect(by('cta_verb').status).toBe('pass');
    expect(by('cta_repeated').status).toBe('fail');
    expect(by('trust_present').status).toBe('pass');
    expect(by('contact_visible').status).toBe('fail');
    expect(by('viewport_meta').status).toBe('pass');
    expect(by('meta_description').status).toBe('pass');
    expect(by('structured_data').status).toBe('fail');
    expect(by('open_graph').status).toBe('fail'); // no og tags on the fixture
    expect(by('form_length').status).toBe('unknown'); // no form is not a pass
    expect(by('html_lang').status).toBe('pass');
  });

  it('keeps head checks and blanks body checks on a client-rendered page', () => {
    const shell = extractAuditEvidence('<html lang="en"><head><title>App dashboard for teams</title><meta name="viewport" content="width=device-width"></head><body><div id="root"></div></body></html>', 'https://app.test/');
    const c = runChecklist(shell);
    expect(c.find((x) => x.id === 'viewport_meta')!.status).toBe('pass');
    expect(c.find((x) => x.id === 'one_h1')!.status).toBe('unknown');
    expect(c.find((x) => x.id === 'cta_in_opening')!.status).toBe('unknown');
  });

  it('scores checks-scored categories from the pass ratio and refuses with under two decided checks', () => {
    expect(scoreFromChecks('seo', [])).toBeNull();
    const all = (status: 'pass' | 'fail') => ['a', 'b', 'c'].map((id) => ({ id, area: 'seo' as const, label: id, status, detail: '' }));
    expect(scoreFromChecks('seo', all('pass'))).toBe(10);
    expect(scoreFromChecks('seo', all('fail'))).toBe(1);
  });

  it('puts a ceiling on a judged score when a fixed rule fails', () => {
    const noCta = [{ id: 'cta_in_opening', area: 'cta' as const, label: '', status: 'fail' as const, detail: '' }];
    expect(scoreCeiling('cta', noCta)?.max).toBe(4);
    expect(scoreCeiling('seo', noCta)).toBeNull();
  });
});

describe('quoteSource — the evidence gate', () => {
  it('finds quotes on the page, in search context, or nowhere', () => {
    expect(quoteSource('Get paid faster without chasing invoices', evidence, '')).toBe('page');
    expect(quoteSource('get PAID faster, without chasing invoices!', evidence, '')).toBe('page'); // case/punctuation tolerant
    expect(quoteSource('the invoice chaser killer', evidence, 'Reviews call it "the invoice chaser killer".')).toBe('search');
    expect(quoteSource('Industry-leading AI-powered synergy', evidence, 'unrelated')).toBeNull();
    expect(quoteSource('', evidence, 'x')).toBeNull();
    expect(quoteSource(null, evidence, 'x')).toBeNull();
  });

  it('accepts ellipsis-joined fragments only when every fragment is present', () => {
    expect(quoteSource('Get paid faster … three days sooner', evidence, '')).toBe('page');
    expect(quoteSource('Get paid faster … five weeks sooner', evidence, '')).toBeNull();
  });

  it('lets a one-word quote match only a whole evidence item, not any substring', () => {
    expect(quoteSource('Pricing', evidence, '')).toBe('page'); // a nav link label
    expect(quoteSource('the', evidence, '')).toBeNull();
    expect(quoteSource('paid', evidence, '')).toBeNull();
  });
});

describe('composeSiteAudit — the post-gate', () => {
  const good = out({
    criteria: [
      {
        area: 'value_proposition', score: 8, observable: true, verdict: 'Concrete outcome in the headline.',
        findings: [
          { kind: 'working', title: 'Specific headline', detail: 'Names the pain and the result.', quote: 'Get paid faster without chasing invoices', impact: null },
          { kind: 'issue', title: 'Invented claim', detail: 'Says it has an award.', quote: 'Winner of the 2025 Best SaaS award', impact: 'None' }, // not in evidence -> dropped
        ],
      },
      { area: 'cta', score: 9, observable: true, verdict: 'Two buttons.', findings: [{ kind: 'issue', title: 'Two equal actions', detail: 'Start and Book compete.', quote: 'Book a demo', impact: 'Splits attention.' }] },
      { area: 'cta', score: 3, observable: true, verdict: 'dup', findings: [] }, // duplicate category, merged
      { area: 'seo', score: 1, observable: true, verdict: 'model opinion', findings: [] }, // checks-scored: score ignored
      { area: 'design', score: 7, observable: true, verdict: 'Looks clean.', findings: [{ kind: 'not_observable', title: 'Colour and layout', detail: 'No screenshot supplied.', quote: null, impact: null }] },
    ],
    fixes: [
      { title: 'Give one action priority', detail: 'Demote "Book a demo".', impact: 'high', effort: 'low', area: 'cta', quote: 'Book a demo' },
      { title: 'Fabricated fix', detail: 'x', impact: 'high', effort: 'low', area: 'messaging', quote: 'text that is nowhere' },
    ],
    testFirst: [
      { title: 'Single CTA', hypothesis: 'If only one button leads then sign-ups rise.', metric: 'sign-up rate', quote: 'Start free trial' },
      { title: 'Ungrounded test', hypothesis: 'h', metric: '', quote: 'nowhere at all' },
    ],
    designSummary: 'Clean.', designQuote: null,
  });

  const audit = compose(good);
  const crit = (a: string) => audit.criteria!.find((c) => c.area === a)!;

  it('drops findings, fixes and tests whose quote is not in the evidence, and counts them', () => {
    expect(crit('value_proposition').findings.map((f) => f.title)).toEqual(['Specific headline']);
    expect(audit.fixes!.some((f) => f.title === 'Fabricated fix')).toBe(false);
    expect(audit.testFirst.map((t) => t.title)).toEqual(['Single CTA']);
    expect(audit.droppedFindings).toBe(3);
  });

  it('stamps where each surviving quote came from', () => {
    expect(crit('value_proposition').findings[0]).toMatchObject({ quote: 'Get paid faster without chasing invoices', evidenceSource: 'page' });
  });

  it('merges duplicate categories and clamps/caps scores', () => {
    expect(audit.criteria!.filter((c) => c.area === 'cta')).toHaveLength(1);
    expect(crit('cta').score).toBe(9); // first score kept; 'Two equal actions' is a real finding; cta_focus passes with 2 actions
    expect(crit('value_proposition').score).toBe(8);
    const wild = compose(out({ criteria: [{ area: 'value_proposition', score: 99, observable: true, verdict: 'v', findings: [{ kind: 'working', title: 'H', detail: 'd', quote: 'Get paid faster without chasing invoices', impact: null }] }] }));
    expect(wild.criteria!.find((c) => c.area === 'value_proposition')!.score).toBe(10);
  });

  it('ignores a model score for a checks-scored category and computes it from the checklist', () => {
    expect(crit('seo').scoredBy).toBe('checks');
    expect(crit('seo').score).toBe(scoreFromChecks('seo', checklist));
    expect(crit('seo').score).not.toBe(1);
  });

  it('never imputes: a category with no evidence-backed finding has a null score and is not counted', () => {
    expect(crit('messaging').score).toBeNull();
    expect(crit('messaging').observable).toBe(false);
    expect(crit('design').score).toBeNull(); // only a not-observable finding: no score
    expect(audit.scores.some((s) => s.area === 'messaging')).toBe(false);
  });

  it('computes the overall as the weight-normalised mean of scored categories, with coverage', () => {
    const scored = audit.criteria!.filter((c) => c.score !== null);
    const w = scored.reduce((s, c) => s + c.weight, 0);
    const expected = Math.round((scored.reduce((s, c) => s + c.weight * c.score!, 0) / w) * 10);
    expect(audit.overall).toBe(expected);
    expect(audit.confidence!.coverage).toBe(Math.round(w) / 100);
    expect(audit.confidence!.coverage).toBeLessThan(1);
    expect(audit.confidence!.note).toMatch(/of the rubric could be observed/);
    expect(audit.version).toBe(2);
  });

  it('keeps legacy working/missing lists populated and design honest', () => {
    expect(audit.working.map((f) => f.title)).toEqual(['Specific headline']);
    expect(audit.missing.map((f) => f.title)).toEqual(['Two equal actions']);
    expect(audit.designStyle.summary).toMatch(/^Not observable/);
  });

  it('sorts fixes by impact then effort and includes checklist-justified fixes', () => {
    const impacts = audit.fixes!.map((f) => f.impact);
    expect(impacts).toEqual([...impacts].sort((a, b) => ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[a]! - ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[b]!));
    expect(audit.fixes!.some((f) => /contact|meta|Open Graph/i.test(f.title))).toBe(true);
  });

  it('applies a hard ceiling when a fixed rule fails', () => {
    const noCtaHtml = extractAuditEvidence(`<html lang="en"><head><title>Plain page title here</title></head><body><h1>Invoices that collect themselves</h1><p>${'Words about invoices and finance teams. '.repeat(12)}</p></body></html>`, 'https://x.test/');
    const cl = runChecklist(noCtaHtml);
    const a = composeSiteAudit({
      url: 'https://x.test/', siteName: 'X', evidence: noCtaHtml, pageStatus: 'read', checklist: cl, groundedText: '', groundedOk: true,
      out: out({ criteria: [{ area: 'cta', score: 9, observable: true, verdict: 'Great', findings: [{ kind: 'working', title: 'Headline', detail: 'd', quote: 'Invoices that collect themselves', impact: null }] }] }),
    });
    const cta = a.criteria!.find((c) => c.area === 'cta')!;
    expect(cta.score).toBe(4);
    expect(cta.verdict).toMatch(/Capped at 4\/10/);
  });
});

describe('fail-soft: page not read', () => {
  const checks = runChecklist(null, 'Blocked by a bot check.');
  const audit = composeSiteAudit({
    url: 'https://x.test/', siteName: 'X', evidence: null, pageStatus: 'unavailable', pageReason: 'Blocked by a bot check.', checklist: checks,
    groundedText: 'Reviewers say X "ships invoices in two clicks" and charges $29 a month.', groundedOk: true,
    out: out({
      criteria: [
        { area: 'value_proposition', score: 7, observable: true, verdict: 'From search.', findings: [{ kind: 'working', title: 'Clear promise', detail: 'd', quote: 'ships invoices in two clicks', impact: null }] },
        { area: 'cta', score: 8, observable: true, verdict: 'Guessing', findings: [{ kind: 'working', title: 'CTA', detail: 'd', quote: 'ships invoices in two clicks', impact: null }] },
      ],
    }),
  });

  it('scores only what search context can show, flags low confidence and says why', () => {
    expect(audit.page).toMatchObject({ status: 'unavailable', reason: 'Blocked by a bot check.' });
    expect(audit.confidence!.level).toBe('low');
    expect(audit.confidence!.pageRead).toBe(false);
    expect(audit.confidence!.note).toMatch(/could not be read/);
    expect(audit.criteria!.find((c) => c.area === 'value_proposition')!.score).toBe(7);
    expect(audit.criteria!.find((c) => c.area === 'value_proposition')!.findings[0]!.evidenceSource).toBe('search');
    // the CTA needs the page; a model score for it is refused
    expect(audit.criteria!.find((c) => c.area === 'cta')!.score).toBeNull();
    expect(audit.criteria!.find((c) => c.area === 'seo')!.score).toBeNull();
    expect(audit.confidence!.coverage).toBeLessThan(0.5);
    expect(audit.checklist!.every((c) => c.status === 'unknown')).toBe(true);
  });

  it('a thin audit is never presented as a clean full-rubric score in the markdown twin', () => {
    const md = siteAuditMarkdown(audit);
    expect(md).toMatch(/Confidence: low/);
    expect(md).toMatch(/partial: \d+% of the rubric observed/);
  });

  it('with nothing observable at all the overall is 0 with no scores, not an invented number', () => {
    const empty = composeSiteAudit({ url: 'https://x.test/', siteName: 'X', evidence: null, pageStatus: 'unavailable', checklist: checks, groundedText: '', groundedOk: false, out: out() });
    expect(empty.scores).toEqual([]);
    expect(empty.overall).toBe(0);
    expect(empty.confidence!.level).toBe('low');
    expect(siteAuditMarkdown(empty)).toMatch(/no score: nothing could be observed/);
  });
});

describe('scoreConfidence', () => {
  it('needs the page read and broad coverage for high; heavy dropping lowers it', () => {
    expect(scoreConfidence({ pageStatus: 'read', coverage: 0.95, dropped: 0, kept: 8, groundedOk: true, reason: null }).level).toBe('high');
    expect(scoreConfidence({ pageStatus: 'read', coverage: 0.7, dropped: 0, kept: 8, groundedOk: true, reason: null }).level).toBe('medium');
    expect(scoreConfidence({ pageStatus: 'read', coverage: 0.95, dropped: 6, kept: 4, groundedOk: true, reason: null }).level).toBe('medium');
    expect(scoreConfidence({ pageStatus: 'js_only', coverage: 0.95, dropped: 0, kept: 8, groundedOk: true, reason: null }).level).toBe('low');
    expect(scoreConfidence({ pageStatus: 'read', coverage: 0.95, dropped: 0, kept: 8, groundedOk: false, reason: null }).level).toBe('medium');
  });
});

describe('classifyAuditPage', () => {
  it('reads a real page, flags a shell, and refuses block pages, plain text and failed reads', () => {
    expect(classifyAuditPage({ status: 'retrieved', text: PAGE }, 'https://acme.test/').status).toBe('read');
    expect(classifyAuditPage({ status: 'retrieved', text: '<html><body><div id="root"></div></body></html>' }, 'https://a.test/').status).toBe('js_only');
    const block = classifyAuditPage({ status: 'retrieved', text: '<html><head><title>Just a moment...</title></head><body><p>Checking your browser before accessing the site.</p></body></html>' }, 'https://a.test/');
    expect(block).toMatchObject({ status: 'unavailable', evidence: null });
    expect(block.reason).toMatch(/bot check/);
    expect(classifyAuditPage({ status: 'retrieved', text: 'just some words with no markup at all' }, 'https://a.test/').status).toBe('unavailable');
    expect(classifyAuditPage({ status: 'unavailable', reason: 'Asset reads need the source reader.' }, 'https://a.test/').reason).toBe('Asset reads need the source reader.');
    expect(classifyAuditPage(null, 'https://a.test/').status).toBe('unavailable');
  });

  it('a genuine long page that merely mentions "captcha" is not treated as blocked', () => {
    const long = `<html><body><h1>Captcha-free forms</h1><p>${'Our product replaces captcha with invisible checks for teams. '.repeat(30)}</p></body></html>`;
    expect(classifyAuditPage({ status: 'retrieved', text: long }, 'https://a.test/').status).toBe('read');
  });
});

describe('buildAuditPrompt', () => {
  it('forbids unquoted findings, demands Not observable, and carries the evidence', () => {
    const p = buildAuditPrompt({ url: 'https://acme.test/', siteName: 'Acme', evidence, checklist, groundedText: 'ctx', pageNote: null });
    expect(p).toMatch(/VERBATIM/);
    expect(p).toMatch(/not_observable/);
    expect(p).toContain('Get paid faster without chasing invoices');
    expect(p).toContain('2 = ');
    expect(p).toContain('8 = ');
    expect(p).toContain('CHECKLIST RESULTS');
  });

  it('when the page was not read, says the facts are not available instead of inventing them', () => {
    const p = buildAuditPrompt({ url: 'https://x.test/', siteName: 'X', evidence: null, checklist: runChecklist(null, 'blocked'), groundedText: '', pageNote: 'The site served a bot check.' });
    expect(p).toContain('PAGE FACTS: NOT AVAILABLE. The site served a bot check.');
    expect(p).not.toContain('PAGE TEXT (');
  });
});
