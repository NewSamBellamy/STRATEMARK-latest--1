import { describe, expect, it } from 'vitest';
import { evidenceCorpus, evidenceDigest, extractAuditEvidence, primaryCtaCandidates } from './site-audit-evidence';

const GOOD = `<!doctype html><html lang="en"><head>
<title>Acme Billing - Invoice customers in two clicks</title>
<meta name="description" content="Acme sends, tracks and reconciles invoices so finance teams stop chasing payments.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Acme Billing"><meta property="og:image" content="https://acme.test/og.png">
<link rel="canonical" href="https://acme.test/">
<link rel="stylesheet" href="/app.css">
<script src="https://www.googletagmanager.com/gtm.js?id=X" async></script>
<script src="/app.js"></script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},{"@type":["Product","SoftwareApplication"]}]}</script>
<style>.hero{display:flex} h1 { color: red }</style>
</head><body>
<header class="site"><nav><a href="/pricing">Pricing</a><a href="/login" class="btn">Log in</a></nav></header>
<main>
<section class="hero"><h1>Get paid faster without chasing invoices</h1>
<p>Acme reconciles every payment automatically, so finance closes the month three days sooner.</p>
<a class="btn btn-primary" href="/signup">Start free trial</a> <a href="/demo">Book a demo</a>
</section>
<section><h2>Trusted by finance teams</h2><p>Trusted by 2,400 finance teams.</p>
<img src="/a.png" alt="Globex logo" width="100" height="40" loading="lazy"><img src="/b.png" alt="Initech logo"><img src="/c.png" alt="Umbrella logo"><img src="/d.png" alt="">
<blockquote>Acme cut our month-end close from nine days to six and we never chase a invoice by hand anymore.</blockquote>
<p>Rated 4.8/5 on G2. SOC 2 Type II. 30-day money-back guarantee. Plans from $29/month.</p></section>
<section><h2>Talk to us</h2>
<form action="/lead"><label for="em">Work email</label><input id="em" name="email" type="email" required>
<input type="hidden" name="src" value="x"><label>Company <input name="co" type="text"></label>
<button type="submit">Request a quote</button></form>
<a href="tel:+14155550123">+1 415 555 0123</a>
</section></main>
<footer><a href="/privacy">Privacy</a><a href="https://twitter.com/acme">Twitter</a><a href="#">Top</a><a href="/signup" class="btn">Start free trial</a></footer>
</body></html>`;

const JS_ONLY = `<!doctype html><html><head><title>App</title><script src="/bundle.js"></script></head>
<body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;

describe('extractAuditEvidence', () => {
  const e = extractAuditEvidence(GOOD, 'https://www.acme.test/');

  it('reads head facts exactly as the page states them', () => {
    expect(e.title).toBe('Acme Billing - Invoice customers in two clicks');
    expect(e.metaDescription).toContain('reconciles invoices');
    expect(e.og.title).toBe('Acme Billing');
    expect(e.og.image).toBe('https://acme.test/og.png');
    expect(e.canonical).toBe('https://acme.test/');
    expect(e.lang).toBe('en');
    expect(e.https).toBe(true);
    expect(e.host).toBe('acme.test');
  });

  it('reads the heading outline and never leaks script or style text', () => {
    expect(e.h1Count).toBe(1);
    expect(e.headings[0]).toEqual({ level: 1, text: 'Get paid faster without chasing invoices' });
    expect(e.headings.map((h) => h.level)).toEqual([1, 2, 2]);
    expect(e.headingSkips).toBe(0);
    expect(e.text).not.toContain('display:flex');
    expect(e.text).not.toContain('schema.org');
  });

  it('puts the hero copy above the fold and keeps nav and footer out of it', () => {
    expect(e.aboveTheFold).toContain('Get paid faster');
    expect(e.aboveTheFold).not.toContain('Privacy');
    expect(e.aboveTheFold).not.toContain('Pricing');
  });

  it('classifies CTAs by where they sit and what they say', () => {
    const hero = primaryCtaCandidates(e).map((c) => c.label);
    expect(hero).toEqual(expect.arrayContaining(['Start free trial', 'Book a demo']));
    const login = e.ctas.find((c) => c.label === 'Log in');
    expect(login?.location).toBe('nav');
    const footer = e.ctas.find((c) => c.label === 'Start free trial' && c.location === 'footer');
    expect(footer).toBeTruthy();
    expect(e.ctas.find((c) => c.label === 'Start free trial' && c.location === 'hero')?.verbLed).toBe(true);
    expect(e.ctas.some((c) => c.label === 'Privacy')).toBe(false); // ordinary links are not CTAs
    expect(e.ctas.find((c) => c.label === 'Request a quote')?.kind).toBe('submit');
  });

  it('reads forms: visible fields only, required flags, labels', () => {
    expect(e.forms).toHaveLength(1);
    const f = e.forms[0]!;
    expect(f.fields).toHaveLength(2); // hidden input is not a field
    expect(f.fields[0]).toMatchObject({ type: 'email', required: true, labelled: true, label: 'Work email' });
    expect(f.fields[1]).toMatchObject({ type: 'text', required: false, labelled: true, label: 'Company' });
    expect(f.submitLabel).toBe('Request a quote');
  });

  it('finds trust signals with verbatim quotes', () => {
    const kinds = e.trust.map((t) => t.kind);
    expect(kinds).toEqual(expect.arrayContaining(['logos', 'testimonial', 'rating', 'security', 'guarantee', 'pricing', 'phone']));
    for (const t of e.trust) expect(t.quote.length).toBeGreaterThan(2);
    expect(e.trust.find((t) => t.kind === 'rating')?.quote).toContain('4.8/5');
  });

  it('reads viewport, image alt coverage, links, structured data and third-party scripts', () => {
    expect(e.viewport).toMatchObject({ present: true, deviceWidth: true, blocksZoom: false });
    expect(e.images).toMatchObject({ total: 4, withAlt: 3, emptyAlt: 1, missingAlt: 0, lazy: 1, sized: 1 });
    expect(e.links.empty).toBe(1); // href="#"
    expect(e.links.external).toBe(1);
    expect(e.structuredData.jsonLdTypes).toEqual(expect.arrayContaining(['Organization', 'Product', 'SoftwareApplication']));
    expect(e.scripts.total).toBe(3);
    expect(e.scripts.thirdPartyHosts).toEqual(['googletagmanager.com']);
    expect(e.stylesheets).toBe(1);
    expect(e.jsRendered).toBe(false);
  });

  it('the digest and corpus carry the facts the model may quote, and say NONE FOUND for gaps', () => {
    const d = evidenceDigest(e);
    expect(d).toContain('"Get paid faster without chasing invoices"');
    expect(d).toContain('Start free trial');
    expect(evidenceCorpus(e)).toContain('money-back guarantee');
    const bare = extractAuditEvidence('<html><body><h1>Hello</h1><p>' + 'word '.repeat(60) + '</p></body></html>', 'http://x.test/');
    const bd = evidenceDigest(bare);
    expect(bd).toContain('META DESCRIPTION: NONE FOUND');
    expect(bd).toContain('CTAs IN THE OPENING CONTENT (0): NONE FOUND');
    expect(bd).toContain('FORMS: NONE FOUND');
    expect(bare.https).toBe(false);
  });
});

describe('extractAuditEvidence — degenerate pages', () => {
  it('flags a client-rendered shell as jsRendered instead of inventing copy', () => {
    const e = extractAuditEvidence(JS_ONLY, 'https://app.test/');
    expect(e.jsRendered).toBe(true);
    expect(e.wordCount).toBeLessThan(10);
    expect(e.h1Count).toBe(0);
    expect(e.ctas).toEqual([]);
  });

  it('survives malformed markup, unclosed tags and attribute values containing ">"', () => {
    const e = extractAuditEvidence(
      `<html><body><div data-x="a>b"><h1>Unclosed heading<p>${'text '.repeat(50)}<a class="cta" href="/x">Try it now`,
      'https://m.test/',
    );
    expect(e.headings.length).toBeGreaterThanOrEqual(1);
    expect(e.wordCount).toBeGreaterThan(40);
  });

  it('counts missing alt attributes and a zoom-blocking viewport', () => {
    const e = extractAuditEvidence(
      `<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body><img src="a.png"><img src="b.png" alt="B"><h1>T</h1><h3>Skipped</h3></body></html>`,
      'https://m.test/',
    );
    expect(e.images.missingAlt).toBe(1);
    expect(e.viewport.blocksZoom).toBe(true);
    expect(e.headingSkips).toBe(1);
  });

  it('does not treat hidden elements as visible copy', () => {
    const e = extractAuditEvidence(`<html><body><div hidden>Secret hidden offer</div><p>${'visible '.repeat(50)}</p></body></html>`, 'https://m.test/');
    expect(e.text).not.toContain('Secret hidden offer');
  });
});
