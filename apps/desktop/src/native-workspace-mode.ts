import type { NativeResearchRun } from '@mi/contracts';

export type NativeWorkspaceMode = {
  provenance: NonNullable<NativeResearchRun['researchProvenance']> | 'unclassified';
  writable: boolean;
};

/** Resolve persisted research origin before choosing a provider or initializing its service. */
export function resolveNativeWorkspaceMode(
  runs: readonly Pick<NativeResearchRun, 'researchProvenance'>[],
  fixture: boolean,
): NativeWorkspaceMode {
  if (!runs.length)
    return { provenance: fixture ? 'synthetic_fixture' : 'live_provider', writable: true };
  if (runs.every((run) => run.researchProvenance === 'synthetic_fixture'))
    return { provenance: 'synthetic_fixture', writable: fixture };
  if (runs.every((run) => run.researchProvenance === 'live_provider')) {
    if (fixture) throw new Error('Live provider research cannot be opened in fixture mode.');
    return { provenance: 'live_provider', writable: true };
  }
  if (fixture) throw new Error('Unclassified or mixed research cannot be opened in fixture mode.');
  return { provenance: 'unclassified', writable: false };
}
