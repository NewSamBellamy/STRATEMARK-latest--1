/**
 * Site-audit evidence: FACTS extracted from a landing page's raw HTML.
 *
 * Pure and deterministic (no network, no DOM, no model). The audit model is
 * handed these facts plus the page text and may only quote from them; the
 * deterministic checklist in site-audit-rubric.ts is computed from them.
 *
 * Honesty notes (Rule 9, unknown stays unknown):
 *  - Source HTML is not a rendered page. "Above the fold" is a SOURCE-ORDER
 *    proxy (the first ~900 characters of body text outside nav/footer), not a
 *    measured viewport. Nothing here claims pixel layout, colour or contrast.
 *  - A page that renders client-side ships almost no text; that is reported as
 *    `jsRendered`, and every fact about copy is then simply absent, not guessed.
 *  - Weight is the HTML document plus a count of referenced assets; transfer
 *    size of images/scripts is unknown and is not estimated.
 */

export interface AuditCta {
  label: string;
  /** Where it sits in source order: nav chrome, the opening content, the footer, or later body. */
  location: 'nav' | 'hero' | 'body' | 'footer';
  kind: 'link' | 'button' | 'submit';
  /** Label opens with an action verb (Get, Start, Book...). */
  verbLed: boolean;
  /** Label is a stock phrase that says nothing about the outcome ("Submit", "Learn more"). */
  generic: boolean;
  href: string | null;
}

export interface AuditFormField {
  type: string;
  name: string | null;
  required: boolean;
  /** A real label (label[for], wrapping label, or aria-label). Placeholder alone does not count. */
  labelled: boolean;
  label: string | null;
}

export interface AuditForm {
  fields: AuditFormField[];
  submitLabel: string | null;
  location: 'hero' | 'body' | 'footer';
  action: string | null;
}

export type TrustKind =
  | 'logos'
  | 'testimonial'
  | 'rating'
  | 'security'
  | 'guarantee'
  | 'pricing'
  | 'phone'
  | 'email'
  | 'address';

export interface AuditTrustSignal {
  kind: TrustKind;
  /** Verbatim text the signal was found in (<= 140 chars). */
  quote: string;
}

export interface AuditHeading {
  level: number;
  text: string;
}

export interface AuditEvidence {
  url: string;
  host: string;
  /** Character length of the HTML document as supplied. */
  htmlBytes: number;
  /** Too little text to judge copy: a client-rendered shell, a block page or an error page. */
  jsRendered: boolean;
  wordCount: number;
  /** The page text, in source order, tags and chrome stripped (capped for prompts by the caller). */
  text: string;
  lang: string | null;
  title: string | null;
  metaDescription: string | null;
  og: { title: string | null; description: string | null; image: string | null };
  canonical: string | null;
  robots: string | null;
  hreflangCount: number;
  structuredData: { jsonLdTypes: string[]; microdataItems: number };
  headings: AuditHeading[];
  h1Count: number;
  headingSkips: number;
  aboveTheFold: string;
  ctas: AuditCta[];
  forms: AuditForm[];
  trust: AuditTrustSignal[];
  viewport: { present: boolean; content: string | null; deviceWidth: boolean; blocksZoom: boolean };
  images: { total: number; withAlt: number; emptyAlt: number; missingAlt: number; lazy: number; sized: number };
  links: { total: number; internal: number; external: number; empty: number; nav: number; body: number };
  scripts: { total: number; inlineBytes: number; thirdPartyHosts: string[]; thirdPartyCount: number };
  stylesheets: number;
  https: boolean;
}

/* ------------------------------------------------------------------ helpers */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', middot: '.', copy: '(c)', reg: '(R)' };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => { const c = Number(n); return c > 0 && c < 0x10ffff ? String.fromCodePoint(c) : ' '; })
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => { const c = parseInt(n, 16); return c > 0 && c < 0x10ffff ? String.fromCodePoint(c) : ' '; })
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

function squash(s: string): string {
  return decode(s).replace(/\s+/g, ' ').trim();
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) {
    const key = m[1]!.toLowerCase();
    if (!(key in out)) out[key] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const REGION = new Set(['nav', 'header', 'footer', 'aside', 'main', 'form']);

type Token =
  | { t: 'text'; text: string }
  | { t: 'open' | 'close'; name: string; attrs: Record<string, string> };

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    if (m.index! > last) tokens.push({ t: 'text', text: html.slice(last, m.index) });
    last = m.index! + m[0].length;
    const name = m[2]!.toLowerCase();
    const closing = m[1] === '/';
    tokens.push({ t: closing ? 'close' : 'open', name, attrs: closing ? {} : parseAttrs(m[3]!.replace(/\/\s*$/, '')) });
  }
  if (last < html.length) tokens.push({ t: 'text', text: html.slice(last) });
  return tokens;
}

function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const twoPart = /^(co|com|org|net|gov|ac)$/.test(parts[parts.length - 2]!) && parts[parts.length - 1]!.length === 2;
  return parts.slice(twoPart ? -3 : -2).join('.');
}

const ACTION_VERBS = new Set([
  'get', 'start', 'try', 'book', 'buy', 'sign', 'signup', 'join', 'request', 'download', 'contact', 'schedule', 'see', 'learn',
  'view', 'shop', 'subscribe', 'create', 'build', 'explore', 'watch', 'talk', 'claim', 'order', 'apply', 'register', 'begin',
  'launch', 'continue', 'add', 'order', 'reserve', 'speak', 'chat', 'compare', 'find', 'discover', 'browse', 'upgrade', 'unlock',
  'read', 'play', 'log', 'login', 'install', 'activate', 'donate', 'support', 'pre-order', 'preorder', 'save', 'check', 'send',
]);
const GENERIC = /^(submit|send|click here|here|learn more|read more|more|go|ok|continue|next|enter|view more|see more|details)$/i;

/** An element that is probably a call to action rather than ordinary navigation. */
function classLooksLikeButton(cls: string): boolean {
  return /(^|[\s_-])(btn|button|cta|primary|action)([\s_-]|$)/i.test(cls);
}

/* ---------------------------------------------------------------- the pass */

const FOLD_CHARS = 900;

interface Frame { name: string; region: 'nav' | 'footer' | 'aside' | 'other' | 'main' | 'form'; hidden: boolean }

export function extractAuditEvidence(rawHtml: string, pageUrl: string): AuditEvidence {
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, ' ').slice(0, 2_500_000);
  let host = pageUrl;
  let origin = '';
  let https = false;
  try {
    const u = new URL(pageUrl);
    host = u.hostname.replace(/^www\./, '');
    origin = registrable(u.hostname);
    https = u.protocol === 'https:';
  } catch { /* keep raw */ }

  // Scripts first: they hold JSON-LD, third-party hosts and inline weight, and
  // their bodies must never leak into the visible text.
  const scriptSrcs: string[] = [];
  const jsonLd: string[] = [];
  let inlineBytes = 0;
  let scriptTotal = 0;
  const withoutRaw = html
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_m, a: string, body: string) => {
      scriptTotal += 1;
      const attrs = parseAttrs(a);
      if (attrs.src) scriptSrcs.push(attrs.src);
      else if ((attrs.type ?? '').toLowerCase().includes('ld+json')) jsonLd.push(body);
      else inlineBytes += body.length;
      return ' ';
    })
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, ' ');

  const tokens = tokenize(withoutRaw);

  const thirdParty = new Map<string, number>();
  for (const src of scriptSrcs) {
    try {
      const h = new URL(src, pageUrl).hostname;
      if (origin && registrable(h) !== origin) thirdParty.set(registrable(h), (thirdParty.get(registrable(h)) ?? 0) + 1);
    } catch { /* relative or malformed: first-party */ }
  }

  const meta = new Map<string, string>();
  const headings: AuditHeading[] = [];
  const ctas: AuditCta[] = [];
  const forms: AuditForm[] = [];
  const trust: AuditTrustSignal[] = [];
  const labelFor = new Map<string, string>();
  const img = { total: 0, withAlt: 0, emptyAlt: 0, missingAlt: 0, lazy: 0, sized: 0 };
  const links = { total: 0, internal: 0, external: 0, empty: 0, nav: 0, body: 0 };
  let title: string | null = null;
  let canonical: string | null = null;
  let lang: string | null = null;
  let stylesheets = 0;
  let hreflang = 0;
  let microdata = 0;
  let h1Seen = false;
  let inBody = false;
  const logoAlts: string[] = [];

  const stack: Frame[] = [];
  const textParts: string[] = [];
  const foldParts: string[] = [];
  let foldLen = 0;

  const region = (): 'nav' | 'footer' | 'hero' | 'body' => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const f = stack[i]!;
      if (f.region === 'nav') return 'nav';
      if (f.region === 'footer') return 'footer';
      // A <header> is site chrome until the page's first <h1>; after that it is the hero.
      if (f.name === 'header' && !h1Seen) return 'nav';
    }
    return foldLen < FOLD_CHARS ? 'hero' : 'body';
  };
  const hiddenNow = (): boolean => stack.some((f) => f.hidden);

  // Inner text of the element opened at tokens[i] (same-name nesting aware).
  const innerText = (i: number, name: string, limit = 400): { text: string; end: number } => {
    let depth = 1;
    const out: string[] = [];
    let j = i + 1;
    for (; j < tokens.length && depth > 0; j += 1) {
      const k = tokens[j]!;
      if (k.t === 'text') { out.push(k.text); continue; }
      if (k.name === name && !VOID.has(name)) depth += k.t === 'open' ? 1 : -1;
      else if (k.t === 'open' && k.name === 'img' && k.attrs.alt) out.push(` ${k.attrs.alt} `);
      else if (k.t === 'open' && k.attrs['aria-hidden'] === 'true' && name !== k.name) { /* decorative */ }
      if (out.join('').length > limit * 3) break;
    }
    return { text: squash(out.join(' ')), end: j };
  };

  const addCta = (label: string, kind: AuditCta['kind'], cls: string, href: string | null, asButton: boolean): void => {
    const words = label.split(' ').filter(Boolean);
    if (!label || label.length > 48 || words.length > 7) return;
    const first = words[0]!.toLowerCase().replace(/[^a-z-]/g, '');
    const verbLed = ACTION_VERBS.has(first);
    if (!asButton && !classLooksLikeButton(cls) && !verbLed) return; // an ordinary link
    ctas.push({ label, location: region(), kind, verbLed, generic: GENERIC.test(label), href });
  };

  let currentForm: { form: AuditForm } | null = null;
  let formDepth = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i]!;

    if (tk.t === 'text') {
      if (!inBody || hiddenNow()) continue;
      const s = squash(tk.text);
      if (!s) continue;
      textParts.push(s);
      const r = region();
      if (r !== 'nav' && r !== 'footer' && foldLen < FOLD_CHARS) { foldParts.push(s); foldLen += s.length + 1; }
      continue;
    }

    if (tk.t === 'close') {
      if (tk.name === 'form') {
        formDepth = Math.max(0, formDepth - 1);
        if (formDepth === 0) currentForm = null;
      }
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k]!.name === tk.name) { stack.length = k; break; }
      }
      continue;
    }

    const { name, attrs } = tk;
    switch (name) {
      case 'html': lang = attrs.lang?.trim() || null; break;
      case 'body': inBody = true; break;
      case 'title': if (!title) { const t = innerText(i, 'title', 300).text; title = t || null; } break;
      case 'meta': {
        const key = (attrs.name ?? attrs.property ?? attrs['http-equiv'] ?? '').toLowerCase();
        if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content.trim());
        break;
      }
      case 'link': {
        const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
        if (rel.includes('canonical') && attrs.href && !canonical) canonical = attrs.href;
        if (rel.includes('stylesheet')) stylesheets += 1;
        if (rel.includes('alternate') && attrs.hreflang) hreflang += 1;
        break;
      }
      default: break;
    }
    if (attrs.itemtype) microdata += 1;
    // No <body> tag (fragments, odd servers): treat everything after <head> as body.
    if (!inBody && !['html', 'head', 'meta', 'link', 'title', 'base', 'script', 'style'].includes(name)) inBody = true;

    if (VOID.has(name)) {
      if (name === 'img' && inBody && !hiddenNow()) {
        img.total += 1;
        if (attrs.alt === undefined) img.missingAlt += 1;
        else if (attrs.alt.trim() === '') img.emptyAlt += 1;
        else img.withAlt += 1;
        if ((attrs.loading ?? '').toLowerCase() === 'lazy') img.lazy += 1;
        if (attrs.width && attrs.height) img.sized += 1;
        const alt = squash(attrs.alt ?? '');
        if (alt && /logo|partner|customer|client|brand/i.test(`${alt} ${attrs.class ?? ''}`)) logoAlts.push(alt);
      }
      if (name === 'input' && currentForm && inBody) {
        const type = (attrs.type ?? 'text').toLowerCase();
        if (type === 'submit' || type === 'button' || type === 'image') {
          const label = squash(attrs.value ?? attrs.alt ?? '');
          if (type === 'submit') {
            if (label && !currentForm.form.submitLabel) currentForm.form.submitLabel = label;
            if (label) addCta(label, 'submit', attrs.class ?? '', null, true);
          }
        } else if (type !== 'hidden' && type !== 'reset') {
          currentForm.form.fields.push({
            type, name: attrs.name ?? attrs.id ?? null, required: 'required' in attrs || attrs['aria-required'] === 'true',
            labelled: Boolean(attrs['aria-label']?.trim() || attrs['aria-labelledby']), label: attrs['aria-label']?.trim() || null,
            ...(attrs.id ? { _id: attrs.id } : {}),
          } as AuditFormField);
        }
      }
      continue;
    }

    // Non-void elements: push a frame so close tags and regions line up.
    const hidden = 'hidden' in attrs || attrs['aria-hidden'] === 'true' || /display\s*:\s*none/i.test(attrs.style ?? '');
    const reg: Frame['region'] = REGION.has(name) && name !== 'header' ? (name as Frame['region']) : 'other';
    stack.push({ name, region: reg, hidden });
    if (hidden) continue;

    if (/^h[1-6]$/.test(name) && inBody) {
      const text = innerText(i, name, 200).text;
      if (text) {
        headings.push({ level: Number(name[1]), text: clip(text, 160) });
        if (name === 'h1') h1Seen = true;
      }
    } else if (name === 'a' && inBody) {
      const href = (attrs.href ?? '').trim();
      links.total += 1;
      const r = region();
      if (r === 'nav') links.nav += 1; else links.body += 1;
      if (!href || href === '#' || /^javascript:/i.test(href)) links.empty += 1;
      else if (/^(mailto:|tel:)/i.test(href)) { /* contact link: neither */ }
      else {
        try {
          const u = new URL(href, pageUrl);
          if (origin && registrable(u.hostname) === origin) links.internal += 1; else links.external += 1;
        } catch { links.internal += 1; }
      }
      const label = innerText(i, 'a').text;
      if (/^tel:/i.test(href)) trust.push({ kind: 'phone', quote: clip(label || href.replace(/^tel:/i, ''), 140) });
      if (/^mailto:/i.test(href)) trust.push({ kind: 'email', quote: clip(label || href.replace(/^mailto:/i, ''), 140) });
      addCta(label, 'link', attrs.class ?? '', href || null, attrs.role === 'button');
    } else if (name === 'button' && inBody) {
      const type = (attrs.type ?? 'submit').toLowerCase();
      const label = squash(innerText(i, 'button').text || attrs['aria-label'] || '');
      if (label) {
        if (currentForm && type === 'submit' && !currentForm.form.submitLabel) currentForm.form.submitLabel = label;
        addCta(label, currentForm && type === 'submit' ? 'submit' : 'button', attrs.class ?? '', null, true);
      }
    } else if (name === 'form' && inBody) {
      formDepth += 1;
      if (formDepth === 1) {
        const loc = region();
        const form: AuditForm = { fields: [], submitLabel: null, location: loc === 'footer' ? 'footer' : loc === 'hero' ? 'hero' : 'body', action: attrs.action ?? null };
        forms.push(form);
        currentForm = { form };
      }
    } else if ((name === 'select' || name === 'textarea') && currentForm && inBody) {
      currentForm.form.fields.push({
        type: name, name: attrs.name ?? attrs.id ?? null, required: 'required' in attrs || attrs['aria-required'] === 'true',
        labelled: Boolean(attrs['aria-label']?.trim() || attrs['aria-labelledby']), label: attrs['aria-label']?.trim() || null,
        ...(attrs.id ? { _id: attrs.id } : {}),
      } as AuditFormField);
    } else if (name === 'label' && inBody) {
      const text = innerText(i, 'label', 120).text;
      if (text && attrs.for) labelFor.set(attrs.for, text);
      // A wrapping label labels the next field inside it; mark by pairing below.
      if (text && !attrs.for && currentForm) {
        const wrapped = tokens.slice(i + 1, i + 12).find((t) => t.t === 'open' && ['input', 'select', 'textarea'].includes(t.name));
        if (wrapped && wrapped.t === 'open') {
          const id = wrapped.attrs.id ?? `__wrap_${i}`;
          if (!wrapped.attrs.id) wrapped.attrs.id = id;
          labelFor.set(id, text);
        }
      }
    } else if (name === 'blockquote' && inBody) {
      const text = innerText(i, 'blockquote', 200).text;
      if (text.length >= 20) trust.push({ kind: 'testimonial', quote: clip(text, 140) });
    } else if (name === 'address' && inBody) {
      const text = innerText(i, 'address', 200).text;
      if (text) trust.push({ kind: 'address', quote: clip(text, 140) });
    }
  }

  // Resolve form labels now that every <label for> has been seen.
  for (const form of forms) {
    for (const f of form.fields as Array<AuditFormField & { _id?: string }>) {
      const found = f._id ? labelFor.get(f._id) : undefined;
      if (found) { f.labelled = true; f.label = found; }
      delete f._id;
    }
  }

  const text = textParts.join(' ');
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  // Text-pattern trust signals, each tied to the verbatim sentence it was found in.
  const snippet = (re: RegExp): string | null => {
    const m = re.exec(text);
    if (!m) return null;
    const from = Math.max(0, m.index - 50);
    return clip(text.slice(from, Math.min(text.length, m.index + m[0].length + 70)).trim(), 140);
  };
  const patterns: Array<[TrustKind, RegExp]> = [
    ['logos', /\b(trusted by|used by|loved by|powering|as seen (in|on)|featured (in|on)|our (customers|clients|partners)|customers include)\b/i],
    ['rating', /\b\d(\.\d)?\s*(\/|out of)\s*5\b|★|\b(trustpilot|g2|capterra|app store|google reviews?)\b|\b\d[\d,]*\+?\s+(reviews|ratings)\b/i],
    ['security', /\b(soc ?2|iso ?27001|gdpr|hipaa|pci[- ]dss|ssl|256-bit|encrypted|enterprise-grade security)\b/i],
    ['guarantee', /\b(money[- ]back|guarantee[d]?|free trial|cancel anytime|no credit card|risk[- ]free|free shipping|free returns)\b/i],
    ['pricing', /[$€£]\s?\d[\d,.]*|\b\d[\d,.]*\s?(\/|per)\s?(mo|month|yr|year|user|seat)\b|\bpricing\b/i],
    ['phone', /\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/],
    ['testimonial', /[“"][^”"]{25,200}[”"]\s*[-—–]\s*[A-Z][a-z]+/],
  ];
  for (const [kind, re] of patterns) {
    if (trust.some((t) => t.kind === kind)) continue;
    const quote = snippet(re);
    if (quote) trust.push({ kind, quote });
  }
  if (logoAlts.length >= 3 && !trust.some((t) => t.kind === 'logos' && /logo|partner/i.test(t.quote))) {
    trust.push({ kind: 'logos', quote: clip(`${logoAlts.length} logo images: ${logoAlts.slice(0, 5).join(', ')}`, 140) });
  }

  const jsonLdTypes: string[] = [];
  for (const raw of jsonLd) {
    try {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          const t = o['@type'];
          for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string' && !jsonLdTypes.includes(x)) jsonLdTypes.push(x);
          if (o['@graph']) walk(o['@graph']);
        }
      };
      walk(JSON.parse(raw));
    } catch { /* malformed JSON-LD is itself a finding the checklist can state */ }
  }

  let skips = 0;
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i]!.level > headings[i - 1]!.level + 1) skips += 1;
  }

  const viewportContent = meta.get('viewport') ?? null;
  const emptyShell = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(withoutRaw);
  const jsRendered = wordCount < 40 || (emptyShell && wordCount < 120);

  const og = { title: meta.get('og:title') ?? null, description: meta.get('og:description') ?? null, image: meta.get('og:image') ?? null };
  const thirdPartyHosts = [...thirdParty.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 12);

  return {
    url: pageUrl,
    host,
    htmlBytes: rawHtml.length,
    jsRendered,
    wordCount,
    text,
    lang,
    title,
    metaDescription: meta.get('description') || null,
    og,
    canonical,
    robots: meta.get('robots') ?? null,
    hreflangCount: hreflang,
    structuredData: { jsonLdTypes, microdataItems: microdata },
    headings,
    h1Count: headings.filter((h) => h.level === 1).length,
    headingSkips: skips,
    aboveTheFold: foldParts.join(' ').trim(),
    ctas: dedupeCtas(ctas),
    forms,
    trust: dedupeTrust(trust),
    viewport: {
      present: viewportContent !== null,
      content: viewportContent,
      deviceWidth: /width\s*=\s*device-width/i.test(viewportContent ?? ''),
      blocksZoom: /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewportContent ?? ''),
    },
    images: img,
    links,
    scripts: { total: scriptTotal, inlineBytes, thirdPartyHosts, thirdPartyCount: [...thirdParty.values()].reduce((a, b) => a + b, 0) },
    stylesheets,
    https,
  };
}

function dedupeCtas(list: AuditCta[]): AuditCta[] {
  const seen = new Set<string>();
  const out: AuditCta[] = [];
  for (const c of list) {
    const key = `${c.label.toLowerCase()}|${c.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(0, 40);
}

function dedupeTrust(list: AuditTrustSignal[]): AuditTrustSignal[] {
  const seen = new Set<string>();
  const out: AuditTrustSignal[] = [];
  for (const s of list) {
    const key = `${s.kind}|${s.quote.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 24);
}

/* ------------------------------------------------- what the model may quote */

/** The primary-CTA candidates that matter: hero first, then body, ignoring nav chrome and footer repeats. */
export function primaryCtaCandidates(e: AuditEvidence): AuditCta[] {
  return e.ctas.filter((c) => c.location === 'hero');
}

/**
 * A compact, plain-text fact sheet for the audit prompt. Every line is a fact
 * the page's own HTML states; there is no interpretation here.
 */
export function evidenceDigest(e: AuditEvidence): string {
  const lines: string[] = [];
  const q = (s: string | null): string => (s ? `"${s}"` : 'NONE FOUND');
  lines.push(`URL: ${e.url} (${e.https ? 'https' : 'NOT https'}); html ${Math.round(e.htmlBytes / 1024)} KB; ${e.wordCount} words of visible text`);
  lines.push(`TITLE: ${q(e.title)}`);
  lines.push(`META DESCRIPTION: ${q(e.metaDescription)}`);
  lines.push(`OPEN GRAPH: title ${q(e.og.title)}; description ${q(e.og.description)}; image ${e.og.image ? 'present' : 'NONE FOUND'}`);
  lines.push(`H1 (${e.h1Count}): ${e.headings.filter((h) => h.level === 1).map((h) => q(h.text)).join(' | ') || 'NONE FOUND'}`);
  const outline = e.headings.filter((h) => h.level !== 1).slice(0, 14).map((h) => `h${h.level} ${q(h.text)}`);
  lines.push(`HEADING OUTLINE: ${outline.join('; ') || 'NONE FOUND'}${e.headingSkips ? ` (${e.headingSkips} skipped level(s))` : ''}`);
  lines.push(`ABOVE THE FOLD (source-order proxy, not a measured viewport): ${q(clip(e.aboveTheFold, 700))}`);
  const ctaLine = (c: AuditCta): string => `${q(c.label)} [${c.location}${c.verbLed ? ', verb-led' : ''}${c.generic ? ', generic' : ''}]`;
  const hero = primaryCtaCandidates(e);
  lines.push(`CTAs IN THE OPENING CONTENT (${hero.length}): ${hero.map(ctaLine).join('; ') || 'NONE FOUND'}`);
  const rest = e.ctas.filter((c) => c.location !== 'hero').slice(0, 10);
  lines.push(`OTHER CTAs (${e.ctas.length - hero.length}): ${rest.map(ctaLine).join('; ') || 'NONE FOUND'}`);
  if (e.forms.length) {
    for (const f of e.forms.slice(0, 4)) {
      lines.push(`FORM [${f.location}]: ${f.fields.length} field(s) (${f.fields.map((x) => `${x.type}${x.required ? '*' : ''}${x.labelled ? '' : ' unlabelled'}`).join(', ') || 'none'}); submit ${q(f.submitLabel)}`);
    }
  } else lines.push('FORMS: NONE FOUND');
  lines.push(`TRUST SIGNALS: ${e.trust.map((t) => `${t.kind} ${q(t.quote)}`).join('; ') || 'NONE FOUND'}`);
  lines.push(`VIEWPORT META: ${e.viewport.present ? q(e.viewport.content) : 'NONE FOUND'}`);
  lines.push(`IMAGES: ${e.images.total} (alt text on ${e.images.withAlt}, empty alt on ${e.images.emptyAlt}, no alt attribute on ${e.images.missingAlt})`);
  lines.push(`LINKS: ${e.links.total} (internal ${e.links.internal}, external ${e.links.external}, nav ${e.links.nav}, empty/# ${e.links.empty})`);
  lines.push(`STRUCTURED DATA: ${e.structuredData.jsonLdTypes.join(', ') || 'NONE FOUND'}; CANONICAL: ${e.canonical ?? 'NONE FOUND'}; ROBOTS: ${e.robots ?? 'not set'}`);
  lines.push(`SCRIPTS: ${e.scripts.total} (${e.scripts.thirdPartyCount} third-party${e.scripts.thirdPartyHosts.length ? `: ${e.scripts.thirdPartyHosts.join(', ')}` : ''}); stylesheets ${e.stylesheets}`);
  return lines.join('\n');
}

/**
 * Everything a finding is allowed to quote: the fact sheet plus the page text.
 * The deterministic post-gate checks quotes against this, nothing else.
 */
export function evidenceCorpus(e: AuditEvidence): string {
  return `${evidenceDigest(e)}\n${e.text}\n${e.headings.map((h) => h.text).join('\n')}\n${e.ctas.map((c) => c.label).join('\n')}\n${e.trust.map((t) => t.quote).join('\n')}`;
}

/* --------------------------------------------------- reading a fetched page */

export interface AuditPageRead {
  status: 'read' | 'js_only' | 'unavailable';
  evidence: AuditEvidence | null;
  reason: string | null;
}

const BLOCK_PAGE = /just a moment|checking your browser|attention required|access denied|are you (a )?human|verify you are|captcha|enable javascript and cookies|request blocked|403 forbidden/i;

/**
 * Decide what a fetch actually gave us. A block page, an error page or a
 * non-HTML body is 'unavailable' (the audit then says so and leans on web
 * context); a client-rendered shell is 'js_only'; anything else is 'read'.
 * Never throws.
 */
export function classifyAuditPage(receipt: { status?: string; text?: string; finalUrl?: string; reason?: string; httpStatus?: number } | null | undefined, requestedUrl: string): AuditPageRead {
  if (!receipt || receipt.status !== 'retrieved' || !receipt.text) {
    return { status: 'unavailable', evidence: null, reason: receipt?.reason?.trim() || (receipt?.httpStatus ? `The site answered ${receipt.httpStatus}.` : 'The page could not be fetched.') };
  }
  if (!/<(html|body|head|h1|div|p|a)\b/i.test(receipt.text)) {
    return { status: 'unavailable', evidence: null, reason: 'The page came back as plain text, not HTML.' };
  }
  const evidence = extractAuditEvidence(receipt.text, receipt.finalUrl || requestedUrl);
  if (evidence.wordCount < 120 && BLOCK_PAGE.test(`${evidence.title ?? ''} ${evidence.text}`)) {
    return { status: 'unavailable', evidence: null, reason: 'The site served a bot check or access-denied page instead of its content.' };
  }
  if (evidence.jsRendered) return { status: 'js_only', evidence, reason: 'The page builds its content in the browser, so its HTML has almost no copy.' };
  return { status: 'read', evidence, reason: null };
}
