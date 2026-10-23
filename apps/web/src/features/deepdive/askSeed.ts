/**
 * The question an "Ask about this" button sends. Thin data must never leak into it: no "null", no "undefined", no
 * "Tenure: Unknown", no empty brackets or quotes. A field with nothing in it is left out, and a seed that is left with
 * nothing to ask is dropped so the chat opens empty rather than asking about "null".
 */

const EMPTY = /^(?:unknown|null|undefined|n\/?a|not reported|not available|none|nil|-|–|—)$/i;

/** The value when it holds something; null when it is blank or a placeholder. */
export function present(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text && !EMPTY.test(text) ? text : null;
}

/** "Label: value" lines for the fields that hold something. */
export function contextBlock(pairs: ReadonlyArray<readonly [label: string, value: string | null | undefined]>): string {
  return pairs
    .map(([label, value]) => [label, present(value)] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

/** Last line of defence for any seed: drop "Label: Unknown" lines and tidy what a missing value leaves behind. */
export function sanitizeSeed(seed: string | null | undefined): string | null {
  if (!seed) return null;
  const lines = seed
    .split('\n')
    .filter((line) => {
      const colon = line.indexOf(':');
      return !(colon > 0 && colon < 40 && EMPTY.test(line.slice(colon + 1).trim()) || /^[A-Za-z ]{2,30}:\s*$/.test(line));
    })
    .map((line) => line
      .replace(/"\s*(?:null|undefined)?\s*"/gi, '')
      .replace(/\(\s*(?:null|undefined)?\s*\)/gi, '')
      .replace(/\b(?:null|undefined)\b/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.;?])/g, '$1')
      .trimEnd());
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return /[A-Za-z0-9]{3}/.test(text) ? text : null;
}

export function cardAskSeed(title: string | null | undefined): string | null {
  const name = present(title);
  return name ? `Dig into "${name}": what's the full picture?` : null;
}

export interface PersonAskInput {
  name: string;
  role?: string | null;
  company?: string | null;
  tenure?: string | null;
  priorCompany?: string | null;
  notableProject?: string | null;
  bio?: string | null;
}

export function personAskSeed(p: PersonAskInput): string {
  const role = present(p.role);
  const company = present(p.company);
  const where = company ? ` at ${company}` : '';
  const who = role ? `${p.name} (${role})${where}` : `${p.name}${where}`;
  const known = contextBlock([
    ['Name', p.name],
    ['Role', role],
    ['Company', company],
    ['Tenure', p.tenure],
    ['Prior company', p.priorCompany],
    ['Notable project', p.notableProject],
    ['Reported background', p.bio],
  ]);
  const hasMore = [p.tenure, p.priorCompany, p.notableProject, p.bio].some((v) => present(v));
  const task = 'Use grounded, current sources to cover their background, track record, relevant projects, and any meaningful influence on the company. Separate sourced facts from inference, and say plainly what could not be found.';
  return hasMore
    ? `Research ${who}. Verify and expand the dashboard context below. ${task}\n\nDashboard context:\n${known}`
    : `Research ${who}. Little is on file about them yet, so start from the web. ${task}`;
}

/** `topic (context) for Company`, with whatever is missing simply left out. */
export function digSeed(input: { topic: string; context?: string | null; companyName?: string | null }): string | null {
  const topic = present(input.topic);
  if (!topic) return null;
  const context = present(input.context);
  const company = present(input.companyName);
  return sanitizeSeed(`${topic}${context ? `: ${context}` : ''}${company ? ` (for ${company})` : ''}`);
}
