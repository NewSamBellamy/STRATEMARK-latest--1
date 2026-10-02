/** Display-only original prefix; the retained research scope is never rewritten. */
export function conciseResearchTitle(name: string): string {
  const characters = Array.from(name);
  if (characters.length <= 80) return name;
  const prefix = characters.slice(0, 79).join('');
  return `${prefix.replace(/\s+\S*$/u, '').trimEnd()}…`;
}
