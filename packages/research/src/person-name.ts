/**
 * The same person written two ways on one team list: "David W. Huml" from a
 * press release and "Huml" from the signature block of a filing. Both pass the
 * quote check on their own, so both used to render, and the list showed the
 * chief executive twice.
 *
 * Only a PARTIAL name is ever dropped, and only when a fuller name with the
 * same role is already on the list. A surname that matches nobody stays: it is
 * a sourced record, just a thin one.
 */

const HONORIFICS = new Set(['dr', 'mr', 'ms', 'mrs', 'miss', 'prof', 'sir', 'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md']);

function nameTokens(name: string): string[] {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ').replace(/['’]/g, '').split(/[\s-]+/).filter((token) => token && !HONORIFICS.has(token));
}

/** True when every word of `partial` is a distinct word of `full` (an initial matches a word that starts with it) and `full` says more. */
export function isPartialOfName(partial: string, full: string): boolean {
  const p = nameTokens(partial);
  const f = nameTokens(full);
  if (p.length === 0 || p.length >= f.length) return false;
  const free = [...f];
  for (const token of p) {
    const at = free.findIndex((candidate) => candidate === token || (token.length === 1 && candidate.startsWith(token)));
    if (at < 0) return false;
    free.splice(at, 1);
  }
  return true;
}

const foldRole = (role: string): string => role.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The two roles are the same position, worded alike or one inside the other ("President and Chief Executive Officer"). */
function sameRole(a: string, b: string): boolean {
  const x = foldRole(a);
  const y = foldRole(b);
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Remove people whose name is only part of another listed person's name and who hold the same role.
 * Anyone who reported to a removed person is re-pointed at the fuller record, so no reporting line is lost.
 */
export function dropPartialDuplicates<T extends { id: string; name: string; role: string; parentId?: string | null }>(people: readonly T[]): T[] {
  const kept = new Map<string, string>(); // removed id -> id of the fuller record
  for (const person of people) {
    const fuller = people.find((other) => other.id !== person.id && isPartialOfName(person.name, other.name) && sameRole(person.role, other.role));
    if (fuller) kept.set(person.id, fuller.id);
  }
  if (kept.size === 0) return [...people];
  const resolve = (id: string): string => { let at = id; for (let hop = 0; hop < people.length && kept.has(at); hop += 1) at = kept.get(at)!; return at; };
  return people.filter((person) => !kept.has(person.id)).map((person) => {
    const parent = person.parentId && kept.has(person.parentId) ? resolve(person.parentId) : undefined;
    return parent && parent !== person.id ? { ...person, parentId: parent } : person;
  });
}
