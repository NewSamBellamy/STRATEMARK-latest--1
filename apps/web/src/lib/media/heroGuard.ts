/**
 * A story's hero picture must not name a different company than the story's
 * subject: a Mistral story whose og:image is the Microsoft logo reads as
 * evidence about Mistral. We only reject on positive evidence (a known brand
 * in the picture's host, path or alt text that is not the subject); a picture
 * we cannot place is left alone.
 */
const BRANDS = [
  'microsoft', 'google', 'alphabet', 'openai', 'anthropic', 'nvidia', 'amazon', 'aws', 'meta', 'apple',
  'ibm', 'oracle', 'intel', 'amd', 'tesla', 'samsung', 'salesforce', 'cohere', 'mistral', 'deepmind',
  'huggingface', 'databricks', 'snowflake', 'xai', 'perplexity', 'crusoe', 'coreweave', 'stability',
];

export interface HeroSubject { name: string; website?: string | null }

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** Brand words found in the picture's address or alt text, as whole tokens. */
function brandsIn(text: string): string[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return BRANDS.filter((b) => tokens.includes(b) || (b.length >= 6 && tokens.some((t) => t.startsWith(b))));
}

/** True when the picture's domain or alt text names a company other than the subject. */
export function heroNamesOtherCompany(src: string, alt: string | null | undefined, subject: HeroSubject): boolean {
  const own = [squash(subject.name), squash(hostOf(subject.website ?? '').replace(/^www\./, '').split('.')[0] ?? '')].filter(Boolean);
  const isOwn = (b: string) => own.some((o) => o === b || o.includes(b) || b.includes(o));
  let host = hostOf(src);
  let path = '';
  try { path = decodeURIComponent(new URL(src).pathname); } catch { /* not an absolute url */ }
  // Proxied pictures carry the real address in the query; read that one.
  try {
    const inner = new URL(src).searchParams.get('url');
    if (inner) { host = hostOf(inner); path = decodeURIComponent(new URL(inner).pathname); }
  } catch { /* keep as is */ }
  const found = new Set([...brandsIn(host), ...brandsIn(path), ...brandsIn(alt ?? '')]);
  for (const b of found) if (!isOwn(b)) return true;
  return false;
}
