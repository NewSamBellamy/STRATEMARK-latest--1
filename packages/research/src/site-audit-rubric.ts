/**
 * The site-audit rubric: what "good" means for a landing page, written down.
 *
 * Three parts, all deterministic except the prompt's use by a model:
 *  1. RUBRIC — weighted categories with explicit anchors for what a 2, a 5 and
 *     an 8 look like, so a score means the same thing on every audit.
 *  2. runChecklist — fixed-rule pass/fail/unknown checks computed from the
 *     page's extracted HTML facts. Same page in, same answers out.
 *  3. buildAuditPrompt — the model is the designer / business analyst reading
 *     the evidence; it must quote the evidence for every finding and say
 *     "Not observable" when the evidence does not show something.
 *
 * What this cannot see (stated, not hidden): rendered layout, colour, contrast,
 * imagery, real load time, tap-target size. Source HTML only.
 */
import type { SiteAuditArea, SiteAuditCheck } from '@mi/contracts';
import { evidenceDigest, primaryCtaCandidates, type AuditEvidence } from './site-audit-evidence';

export interface RubricCategory {
  area: SiteAuditArea;
  label: string;
  /** Percent of the overall score. All weights sum to 100. */
  weight: number;
  /** 'checks': score computed from the checklist alone. 'model': judged against the anchors. */
  scoredBy: 'checks' | 'model';
  /** Can the model say anything honest about it from web context when the page itself could not be read? */
  observableWithoutPage: boolean;
  question: string;
  anchors: { low: string; mid: string; high: string };
}

export const RUBRIC: readonly RubricCategory[] = [
  {
    area: 'value_proposition', label: 'Value proposition & 5-second clarity', weight: 20, scoredBy: 'model', observableWithoutPage: true,
    question: 'Would a first-time visitor know what this is, who it is for and why it beats the alternative within five seconds of reading the headline and sub-headline?',
    anchors: {
      low: '2 = the headline is a slogan or brand line ("Reimagine tomorrow"); you cannot tell what is sold or to whom.',
      mid: '5 = the product category is clear but the benefit or audience is generic ("The all-in-one platform for teams").',
      high: '8 = the headline or sub-headline names the audience, a concrete outcome and a differentiator, in plain words.',
    },
  },
  {
    area: 'cta', label: 'Primary call to action: clarity & prominence', weight: 18, scoredBy: 'model', observableWithoutPage: false,
    question: 'Is there ONE obvious next step, worded as an outcome, visible in the opening content, and repeated where the visitor decides?',
    anchors: {
      low: '2 = no call to action in the opening content, or four-plus competing buttons, or only stock labels ("Submit", "Learn more").',
      mid: '5 = a call to action exists in the opening content but is generic or shares equal weight with another equally prominent action.',
      high: '8 = one verb-led, outcome-worded primary action in the opening content, repeated lower down, with a clearly secondary alternative.',
    },
  },
  {
    area: 'trust', label: 'Trust & social proof', weight: 14, scoredBy: 'model', observableWithoutPage: true,
    question: 'Is the promise carried by evidence a stranger can weigh: named customers, numbers, reviews, certifications, guarantees?',
    anchors: {
      low: '2 = no proof anywhere, or only unnamed claims ("trusted by thousands") with nothing checkable.',
      mid: '5 = some proof (logos or one testimonial) but it is generic, unattributed or far below the opening content.',
      high: '8 = specific, attributable proof near the primary action: named customers, a figure with its source, a rating, a guarantee.',
    },
  },
  {
    area: 'messaging', label: 'Message hierarchy & copy', weight: 12, scoredBy: 'model', observableWithoutPage: true,
    question: 'Does the page tell one story in order, in specific benefit-led language, or is it a list of features and buzzwords?',
    anchors: {
      low: '2 = headings do not form a story, copy is buzzwords and company-centred ("we are passionate about").',
      mid: '5 = readable and on topic, but benefits are mixed with features and headings do not carry the argument alone.',
      high: '8 = the headings alone tell the story; each section answers a visitor objection with specific, customer-centred language.',
    },
  },
  {
    area: 'friction', label: 'Friction: forms, navigation, distractions', weight: 10, scoredBy: 'model', observableWithoutPage: false,
    question: 'What stands between a motivated visitor and finishing the primary action: form length, navigation exits, competing links?',
    anchors: {
      low: '2 = long form (6+ fields) or many exits (large navigation, many off-site links) around the primary action.',
      mid: '5 = moderate: a 4-5 field form or a navigation that offers many other places to go.',
      high: '8 = the shortest workable form (1-3 fields, labelled), a lean navigation, few competing links.',
    },
  },
  {
    area: 'design', label: 'Visual hierarchy', weight: 6, scoredBy: 'model', observableWithoutPage: false,
    question: 'From the document structure alone, does the page lead the eye: one H1, ordered sections, the action reachable early? (Colour, imagery and layout are NOT observable from source HTML.)',
    anchors: {
      low: '2 = no clear H1 or a flat run of undifferentiated text before any action.',
      mid: '5 = a sensible heading outline but the action sits well below the opening content.',
      high: '8 = one H1, short ordered sections, the action in the opening content and again at the end.',
    },
  },
  {
    area: 'mobile_performance', label: 'Mobile & performance signals', weight: 6, scoredBy: 'checks', observableWithoutPage: false,
    question: 'Do the page head and weight show it is built for phones and loads light? (Real speed and tap targets are NOT measured.)',
    anchors: {
      low: '2 = no viewport meta, or heavy HTML with many third-party scripts.',
      mid: '5 = viewport present, but heavy or many third-party scripts.',
      high: '8 = device-width viewport, modest HTML, few third-party scripts, images sized to avoid layout shift.',
    },
  },
  {
    area: 'seo', label: 'SEO & technical basics', weight: 8, scoredBy: 'checks', observableWithoutPage: false,
    question: 'Are the fundamentals a search engine and a link preview read in place: title, description, canonical, Open Graph, structured data?',
    anchors: {
      low: '2 = missing title or description, or the page is set to noindex.',
      mid: '5 = title and description exist but lengths, canonical, Open Graph or structured data are missing.',
      high: '8 = sound title and description, canonical, Open Graph with image, and structured data.',
    },
  },
  {
    area: 'accessibility', label: 'Accessibility basics', weight: 6, scoredBy: 'checks', observableWithoutPage: false,
    question: 'Do the basics hold: language declared, image alt text, labelled form fields, orderly headings, zoom allowed? (This is not a WCAG audit.)',
    anchors: {
      low: '2 = images without alt text, unlabelled fields, zoom disabled.',
      mid: '5 = some basics hold but several images or fields are unlabelled, or headings skip levels.',
      high: '8 = lang set, all images have alt, all fields labelled, headings in order, zoom allowed.',
    },
  },
];

export function rubricCategory(area: SiteAuditArea): RubricCategory | undefined {
  return RUBRIC.find((c) => c.area === area);
}

/* ---------------------------------------------------------------- checklist */

type Status = SiteAuditCheck['status'];

const CHECKS_NEEDING_BODY = new Set([
  'one_h1', 'h1_wording', 'cta_in_opening', 'cta_focus', 'cta_verb', 'cta_repeated', 'form_length', 'nav_links', 'dead_links',
  'trust_present', 'contact_visible', 'image_alt', 'form_labels', 'heading_order', 'images_sized',
]);

/**
 * Fixed-rule checks. `evidence` null = the page could not be read: every check
 * is 'unknown' and says so. A client-rendered page keeps its head checks and
 * loses its body checks.
 */
export function runChecklist(e: AuditEvidence | null, unavailableReason?: string): SiteAuditCheck[] {
  const specs: Array<{ id: string; area: SiteAuditArea; label: string; run: (e: AuditEvidence) => { status: Status; detail: string } }> = [
    {
      id: 'one_h1', area: 'value_proposition', label: 'One clear H1 headline',
      run: (x) => x.h1Count === 1
        ? { status: 'pass', detail: `Exactly one H1: "${x.headings.find((h) => h.level === 1)!.text}".` }
        : { status: 'fail', detail: x.h1Count === 0 ? 'No H1 found in the page source.' : `${x.h1Count} H1 headings found; a page should lead with one.` },
    },
    {
      id: 'h1_wording', area: 'value_proposition', label: 'H1 is a readable statement (3-14 words)',
      run: (x) => {
        const h1 = x.headings.find((h) => h.level === 1);
        if (!h1) return { status: 'unknown', detail: 'No H1 to measure.' };
        const n = h1.text.split(/\s+/).length;
        return n >= 3 && n <= 14 ? { status: 'pass', detail: `H1 is ${n} words: "${h1.text}".` } : { status: 'fail', detail: `H1 is ${n} word(s): "${h1.text}".` };
      },
    },
    {
      id: 'cta_in_opening', area: 'cta', label: 'A call to action in the opening content',
      run: (x) => {
        const hero = primaryCtaCandidates(x);
        return hero.length ? { status: 'pass', detail: `Found: ${hero.slice(0, 3).map((c) => `"${c.label}"`).join(', ')}.` } : { status: 'fail', detail: 'No button or action link found in the opening content (source-order proxy for above the fold).' };
      },
    },
    {
      id: 'cta_focus', area: 'cta', label: 'No more than two competing actions in the opening content',
      run: (x) => {
        const n = primaryCtaCandidates(x).length;
        if (n === 0) return { status: 'unknown', detail: 'No opening call to action to count.' };
        return n <= 2 ? { status: 'pass', detail: `${n} action(s) in the opening content.` } : { status: 'fail', detail: `${n} actions compete in the opening content: ${primaryCtaCandidates(x).slice(0, 5).map((c) => `"${c.label}"`).join(', ')}.` };
      },
    },
    {
      id: 'cta_verb', area: 'cta', label: 'Primary action is verb-led and specific',
      run: (x) => {
        const first = primaryCtaCandidates(x)[0];
        if (!first) return { status: 'unknown', detail: 'No opening call to action to read.' };
        return first.verbLed && !first.generic ? { status: 'pass', detail: `"${first.label}" opens with an action verb.` } : { status: 'fail', detail: `"${first.label}" is ${first.generic ? 'a stock label' : 'not worded as an action'}.` };
      },
    },
    {
      id: 'cta_repeated', area: 'cta', label: 'Call to action repeated further down the page',
      run: (x) => {
        const hero = primaryCtaCandidates(x);
        if (!hero.length) return { status: 'unknown', detail: 'No opening call to action to compare.' };
        const later = x.ctas.filter((c) => c.location === 'body' || c.location === 'footer');
        return later.length ? { status: 'pass', detail: `${later.length} further action(s) lower on the page, e.g. "${later[0]!.label}".` } : { status: 'fail', detail: 'No call to action found below the opening content.' };
      },
    },
    {
      id: 'form_length', area: 'friction', label: 'Forms ask for five fields or fewer',
      run: (x) => {
        if (!x.forms.length) return { status: 'unknown', detail: 'No form found in the page source.' };
        const worst = Math.max(...x.forms.map((f) => f.fields.length));
        return worst <= 5 ? { status: 'pass', detail: `Longest form has ${worst} field(s).` } : { status: 'fail', detail: `A form asks for ${worst} fields.` };
      },
    },
    {
      id: 'nav_links', area: 'friction', label: 'Lean navigation (8 links or fewer)',
      run: (x) => x.links.nav <= 8 ? { status: 'pass', detail: `${x.links.nav} navigation link(s).` } : { status: 'fail', detail: `${x.links.nav} navigation links give visitors many places to leave.` },
    },
    {
      id: 'dead_links', area: 'friction', label: 'No placeholder links (href empty, "#" or javascript:)',
      run: (x) => x.links.empty <= 2 ? { status: 'pass', detail: `${x.links.empty} placeholder link(s).` } : { status: 'fail', detail: `${x.links.empty} links go nowhere.` },
    },
    {
      id: 'trust_present', area: 'trust', label: 'Proof present (two or more kinds)',
      run: (x) => {
        const proof = new Set(x.trust.filter((t) => ['logos', 'testimonial', 'rating', 'security', 'guarantee'].includes(t.kind)).map((t) => t.kind));
        return proof.size >= 2
          ? { status: 'pass', detail: `Found: ${[...proof].join(', ')}.` }
          : { status: 'fail', detail: proof.size === 1 ? `Only one kind of proof found: ${[...proof][0]}.` : 'No logos, testimonial, rating, certification or guarantee found in the page source.' };
      },
    },
    {
      id: 'contact_visible', area: 'trust', label: 'A way to reach a human (phone, email or address)',
      run: (x) => {
        const c = x.trust.filter((t) => ['phone', 'email', 'address'].includes(t.kind));
        return c.length ? { status: 'pass', detail: `Found ${c[0]!.kind}: "${c[0]!.quote}".` } : { status: 'fail', detail: 'No phone, email or postal address found in the page source.' };
      },
    },
    {
      id: 'viewport_meta', area: 'mobile_performance', label: 'Mobile viewport meta tag',
      run: (x) => x.viewport.deviceWidth ? { status: 'pass', detail: `"${x.viewport.content}".` } : { status: 'fail', detail: x.viewport.present ? `Viewport "${x.viewport.content}" does not set width=device-width.` : 'No viewport meta tag found.' },
    },
    {
      id: 'html_weight', area: 'mobile_performance', label: 'HTML document under 500 KB',
      run: (x) => x.htmlBytes <= 500_000 ? { status: 'pass', detail: `${Math.round(x.htmlBytes / 1024)} KB of HTML (images and scripts are not counted).` } : { status: 'fail', detail: `${Math.round(x.htmlBytes / 1024)} KB of HTML before any image or script loads.` },
    },
    {
      id: 'third_party', area: 'mobile_performance', label: 'Five or fewer third-party scripts',
      run: (x) => x.scripts.thirdPartyCount <= 5 ? { status: 'pass', detail: `${x.scripts.thirdPartyCount} third-party script(s)${x.scripts.thirdPartyHosts.length ? `: ${x.scripts.thirdPartyHosts.join(', ')}` : ''}.` } : { status: 'fail', detail: `${x.scripts.thirdPartyCount} third-party scripts from ${x.scripts.thirdPartyHosts.join(', ')}.` },
    },
    {
      id: 'images_sized', area: 'mobile_performance', label: 'Images declare width and height (no layout shift)',
      run: (x) => {
        if (x.images.total < 3) return { status: 'unknown', detail: `${x.images.total} image(s): too few to judge.` };
        const share = x.images.sized / x.images.total;
        return share >= 0.8 ? { status: 'pass', detail: `${x.images.sized} of ${x.images.total} images are sized.` } : { status: 'fail', detail: `Only ${x.images.sized} of ${x.images.total} images declare width and height.` };
      },
    },
    {
      id: 'title_length', area: 'seo', label: 'Title tag 10-65 characters',
      run: (x) => !x.title ? { status: 'fail', detail: 'No <title> found.' } : x.title.length >= 10 && x.title.length <= 65 ? { status: 'pass', detail: `"${x.title}" (${x.title.length}).` } : { status: 'fail', detail: `"${x.title}" is ${x.title.length} characters.` },
    },
    {
      id: 'meta_description', area: 'seo', label: 'Meta description 70-170 characters',
      run: (x) => !x.metaDescription ? { status: 'fail', detail: 'No meta description found.' } : x.metaDescription.length >= 70 && x.metaDescription.length <= 170 ? { status: 'pass', detail: `${x.metaDescription.length} characters.` } : { status: 'fail', detail: `${x.metaDescription.length} characters: "${x.metaDescription.slice(0, 80)}".` },
    },
    {
      id: 'canonical', area: 'seo', label: 'Canonical URL declared',
      run: (x) => x.canonical ? { status: 'pass', detail: x.canonical } : { status: 'fail', detail: 'No canonical link found.' },
    },
    {
      id: 'open_graph', area: 'seo', label: 'Open Graph title and image (link previews)',
      run: (x) => x.og.title && x.og.image ? { status: 'pass', detail: `og:title "${x.og.title}" and og:image present.` } : { status: 'fail', detail: `Missing: ${[!x.og.title && 'og:title', !x.og.image && 'og:image'].filter(Boolean).join(', ')}.` },
    },
    {
      id: 'structured_data', area: 'seo', label: 'Structured data (JSON-LD or microdata)',
      run: (x) => x.structuredData.jsonLdTypes.length || x.structuredData.microdataItems ? { status: 'pass', detail: x.structuredData.jsonLdTypes.length ? `JSON-LD types: ${x.structuredData.jsonLdTypes.join(', ')}.` : `${x.structuredData.microdataItems} microdata item(s).` } : { status: 'fail', detail: 'No JSON-LD or microdata found.' },
    },
    {
      id: 'indexable', area: 'seo', label: 'Not blocked from search (no noindex)',
      run: (x) => x.robots && /noindex/i.test(x.robots) ? { status: 'fail', detail: `robots meta is "${x.robots}".` } : { status: 'pass', detail: x.robots ? `robots meta "${x.robots}".` : 'No robots meta; indexable by default.' },
    },
    {
      id: 'https', area: 'seo', label: 'Served over HTTPS',
      run: (x) => x.https ? { status: 'pass', detail: 'The final URL is https.' } : { status: 'fail', detail: 'The URL is not https.' },
    },
    {
      id: 'html_lang', area: 'accessibility', label: 'Page language declared',
      run: (x) => x.lang ? { status: 'pass', detail: `lang="${x.lang}".` } : { status: 'fail', detail: 'No lang attribute on <html>.' },
    },
    {
      id: 'image_alt', area: 'accessibility', label: 'Every image has an alt attribute',
      run: (x) => {
        if (!x.images.total) return { status: 'unknown', detail: 'No images in the page source.' };
        return x.images.missingAlt === 0 ? { status: 'pass', detail: `${x.images.total} image(s), none missing alt (${x.images.emptyAlt} marked decorative).` } : { status: 'fail', detail: `${x.images.missingAlt} of ${x.images.total} images have no alt attribute.` };
      },
    },
    {
      id: 'form_labels', area: 'accessibility', label: 'Every form field has a label',
      run: (x) => {
        const fields = x.forms.flatMap((f) => f.fields);
        if (!fields.length) return { status: 'unknown', detail: 'No form fields found.' };
        const bare = fields.filter((f) => !f.labelled).length;
        return bare === 0 ? { status: 'pass', detail: `All ${fields.length} field(s) are labelled.` } : { status: 'fail', detail: `${bare} of ${fields.length} field(s) have no label (placeholder alone does not count).` };
      },
    },
    {
      id: 'heading_order', area: 'accessibility', label: 'Headings do not skip levels',
      run: (x) => !x.headings.length ? { status: 'unknown', detail: 'No headings found.' } : x.headingSkips === 0 ? { status: 'pass', detail: `${x.headings.length} headings in order.` } : { status: 'fail', detail: `Heading levels skip ${x.headingSkips} time(s).` },
    },
    {
      id: 'zoom_allowed', area: 'accessibility', label: 'Pinch-zoom is not disabled',
      run: (x) => x.viewport.blocksZoom ? { status: 'fail', detail: `Viewport "${x.viewport.content}" blocks zoom.` } : { status: 'pass', detail: 'Zoom is not blocked by the viewport tag.' },
    },
  ];

  return specs.map((s): SiteAuditCheck => {
    const base = { id: s.id, area: s.area, label: s.label };
    if (!e) return { ...base, status: 'unknown', detail: unavailableReason ?? 'The page could not be read.' };
    if (e.jsRendered && CHECKS_NEEDING_BODY.has(s.id)) {
      return { ...base, status: 'unknown', detail: 'The page renders in the browser: its HTML carries no copy to check.' };
    }
    return { ...base, ...s.run(e) };
  });
}

/** Score 1-10 for a checks-scored category, or null when fewer than two checks could be decided. */
export function scoreFromChecks(area: SiteAuditArea, checks: SiteAuditCheck[]): number | null {
  const own = checks.filter((c) => c.area === area && c.status !== 'unknown');
  if (own.length < 2) return null;
  const pass = own.filter((c) => c.status === 'pass').length;
  return Math.max(1, Math.min(10, Math.round(1 + (9 * pass) / own.length)));
}

/**
 * Hard ceilings a fixed rule puts on a model judgement: a model cannot call a
 * call to action "strong" when none exists in the opening content.
 */
export function scoreCeiling(area: SiteAuditArea, checks: SiteAuditCheck[]): { max: number; reason: string } | null {
  const failed = (id: string): boolean => checks.some((c) => c.id === id && c.status === 'fail');
  if (area === 'cta' && failed('cta_in_opening')) return { max: 4, reason: 'no call to action in the opening content' };
  if (area === 'cta' && failed('cta_focus')) return { max: 6, reason: 'several actions compete in the opening content' };
  if (area === 'value_proposition' && failed('one_h1')) return { max: 6, reason: 'the page does not lead with exactly one H1' };
  if (area === 'friction' && failed('form_length')) return { max: 5, reason: 'a form asks for more than five fields' };
  if (area === 'trust' && failed('trust_present')) return { max: 5, reason: 'fewer than two kinds of proof found in the page' };
  return null;
}

/** Fixes the checklist itself justifies, so a thin model answer still leaves the owner with actions. */
export const CHECK_FIXES: Record<string, { title: string; detail: string; impact: 'high' | 'medium' | 'low'; effort: 'high' | 'medium' | 'low' }> = {
  one_h1: { title: 'Lead with exactly one H1', detail: 'Make the headline the single H1 and state who it is for and the outcome they get.', impact: 'high', effort: 'low' },
  cta_in_opening: { title: 'Put one clear action in the opening content', detail: 'Add a single primary button in the first screen of content, worded as the outcome ("Start free trial").', impact: 'high', effort: 'low' },
  cta_focus: { title: 'Cut competing actions in the opening content', detail: 'Keep one primary action and demote the rest to text links so visitors are not asked to choose.', impact: 'high', effort: 'low' },
  cta_verb: { title: 'Reword the primary action as an outcome', detail: 'Replace stock labels with a verb and the result ("Get my quote", not "Submit").', impact: 'medium', effort: 'low' },
  trust_present: { title: 'Add specific proof near the primary action', detail: 'Show named customers, a sourced figure, a rating or a guarantee beside the main button.', impact: 'high', effort: 'medium' },
  form_length: { title: 'Shorten the form', detail: 'Ask only for what is needed to take the next step; every extra field costs completions.', impact: 'high', effort: 'low' },
  viewport_meta: { title: 'Add a device-width viewport meta tag', detail: 'Without it phones render the desktop layout shrunk.', impact: 'high', effort: 'low' },
  meta_description: { title: 'Write a meta description', detail: 'Write 70-160 characters that sell the click in search results.', impact: 'medium', effort: 'low' },
  title_length: { title: 'Fix the title tag', detail: 'Use 10-65 characters leading with what the page offers.', impact: 'medium', effort: 'low' },
  image_alt: { title: 'Add alt text to images', detail: 'Describe informative images and mark decorative ones alt="".', impact: 'medium', effort: 'low' },
  form_labels: { title: 'Label every form field', detail: 'Use a visible label tied to each field; placeholders alone disappear when typing.', impact: 'medium', effort: 'low' },
  indexable: { title: 'Remove the noindex directive', detail: 'The page tells search engines not to list it.', impact: 'high', effort: 'low' },
  open_graph: { title: 'Add Open Graph title and image', detail: 'Links shared in chat and social show a bare URL without them.', impact: 'low', effort: 'low' },
  third_party: { title: 'Trim third-party scripts', detail: 'Each tag adds load time and a failure point; remove the ones nobody reads.', impact: 'medium', effort: 'medium' },
};

/* ------------------------------------------------------------------- prompt */

export interface AuditPromptInput {
  url: string;
  siteName: string;
  evidence: AuditEvidence | null;
  checklist: SiteAuditCheck[];
  groundedText: string;
  pageNote: string | null;
}

const PAGE_TEXT_CAP = 6000;
const GROUND_CAP = 3500;

/** The structure-pass prompt. The model sees evidence, never the open web. */
export function buildAuditPrompt(input: AuditPromptInput): string {
  const { evidence } = input;
  const bodyReadable = evidence !== null && !evidence.jsRendered;
  const lines: string[] = [
    `You are two reviewers at once, auditing the landing page at ${input.url} ("${input.siteName}"): a conversion designer (does the page lead the eye and make the next step obvious?) and a business analyst (does it make a stranger believe, understand and act?). Use established landing-page practice: five-second clarity, one primary call to action, message match, proof, low friction.`,
    ``,
    `GROUND RULES (non-negotiable):`,
    `- You may only judge what the EVIDENCE below shows. Do not use outside knowledge of this company, its product or its design.`,
    `- Every finding MUST carry a "quote": text copied VERBATIM from the PAGE FACTS, PAGE TEXT or WEB CONTEXT below. A finding with no quote that can be found there will be deleted.`,
    `- If the evidence does not show something (colour, imagery, layout, real load speed, anything not in the text), write a finding with kind "not_observable" and no quote. Never guess. "Not observable" is a correct and respected answer.`,
    `- Score each category 1-10 using ONLY these anchors (2 = poor, 5 = average, 8 = strong). Set score null and observable false when the evidence cannot support a judgement.`,
    `- Scores of 1 or 10 need exceptional evidence; most real pages land between 3 and 8.`,
    ``,
    `RUBRIC CATEGORIES (use exactly these "area" ids):`,
    ...RUBRIC.filter((c) => c.scoredBy === 'model').flatMap((c) => [
      `* ${c.area} - ${c.label} (weight ${c.weight}%). ${c.question}`,
      `    ${c.anchors.low}`,
      `    ${c.anchors.mid}`,
      `    ${c.anchors.high}`,
    ]),
    `(mobile_performance, seo and accessibility are scored by fixed rules from the CHECKLIST; do not score them. You may still raise findings about them, quoting evidence.)`,
    ``,
  ];

  if (bodyReadable && evidence) {
    lines.push(`PAGE FACTS (extracted from the page's own HTML):`, evidenceDigest(evidence), ``);
    lines.push(`PAGE TEXT (visible text in source order, first ${PAGE_TEXT_CAP} characters):`, evidence.text.slice(0, PAGE_TEXT_CAP), ``);
  } else {
    lines.push(
      `PAGE FACTS: NOT AVAILABLE. ${input.pageNote ?? 'The page itself could not be read.'}`,
      `Only the WEB CONTEXT below exists. Judge value_proposition, messaging and trust from it if it shows them (quote it); mark every other category not observable with score null.`,
      ``,
    );
    if (evidence) lines.push(`PAGE FACTS (head only; the body renders in the browser):`, evidenceDigest(evidence).split('\n').slice(0, 5).join('\n'), ``);
  }

  lines.push(
    `CHECKLIST RESULTS (fixed rules, already computed; treat as facts):`,
    ...input.checklist.map((c) => `- [${c.status.toUpperCase()}] ${c.label}: ${c.detail}`),
    ``,
    `WEB CONTEXT (grounded search notes about how the site presents itself and is discussed; may be incomplete):`,
    input.groundedText.trim().slice(0, GROUND_CAP) || '(none)',
    ``,
    `OUTPUT: JSON only.`,
    `{ "criteria": [{ "area", "score": 1-10|null, "observable": boolean, "verdict": "one sentence", "findings": [{ "kind": "working"|"issue"|"not_observable", "title": "few words", "detail": "1-3 sentences", "quote": "verbatim from the evidence"|null, "impact": "what it costs, for issues"|null }] }],`,
    `  "fixes": [{ "title", "detail", "impact": "high"|"medium"|"low", "effort": "high"|"medium"|"low", "area", "quote": "verbatim"|null }],`,
    `  "testFirst": [{ "title", "hypothesis": "If we change X to Y then Z should move because ...", "metric": "what to measure", "quote": "verbatim from the evidence the test rests on" }],`,
    `  "designSummary": "the visual/copy register the evidence supports, or 'Not observable from the supplied evidence'", "designQuote": "verbatim"|null, "designNotes": ["only what the evidence shows"] }`,
    `Give 1-4 findings per category, 4-8 fixes ranked by impact, and 3-5 testFirst hypotheses. Fixes are things to change; testFirst are experiments to run.`,
  );
  return lines.join('\n');
}

/** The grounded-pass prompt: external context only. The page itself is read separately. */
export function buildGroundPrompt(url: string, name: string, pageRead: boolean): string {
  return [
    `Research ${name} (${url}) on the open web for a landing-page review.`,
    pageRead
      ? `The page's own HTML is being read separately; do NOT describe the page layout. Report only what lives OUTSIDE it:`
      : `The page's own HTML could not be read, so report as much as search evidence shows about the page itself too (its headline, offer, pricing, copy) and say plainly what you could not verify:`,
    `- how customers and press describe the product, and the words they use;`,
    `- what the company claims publicly (offers, pricing, customers, numbers) with the source;`,
    `- reviews, ratings and complaints, and who the main competitors say they beat.`,
    `Quote wording exactly where you can. Never invent page elements, figures or customers; if search shows nothing, say so.`,
  ].join('\n');
}
