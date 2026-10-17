/**
 * The bundled demo deck (Frontier AI, ~450 KB of JSON) is only needed in demo
 * mode, with no key and no hosted engine. Loading it on demand keeps it out of the
 * first-load bundle every visitor downloads. Memoized: one fetch per session.
 */
import type { SeedSnapshot } from '@mi/mocks';

let pending: Promise<SeedSnapshot> | null = null;

export function loadSampleSnapshot(): Promise<SeedSnapshot> {
  pending ??= import('./frontier-snapshot.json').then((module) => module.default as unknown as SeedSnapshot);
  return pending;
}
