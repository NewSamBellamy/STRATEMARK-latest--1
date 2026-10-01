import { describe, expect, it } from 'vitest';
import type { NativeResearchRun } from '@mi/contracts';
import { resolveNativeWorkspaceMode } from './native-workspace-mode';

const synthetic = { researchProvenance: 'synthetic_fixture' } as const;
const live = { researchProvenance: 'live_provider' } as const;
type Origin = Pick<NativeResearchRun, 'researchProvenance'>;

describe('persisted native workspace origin', () => {
  it.each([false, true])('selects an empty workspace mode from fixture=%s', (fixture) => {
    expect(resolveNativeWorkspaceMode([], fixture)).toEqual({
      provenance: fixture ? 'synthetic_fixture' : 'live_provider',
      writable: true,
    });
  });
  it.each([false, true])('retains the synthetic label with fixture=%s', (fixture) => {
    expect(resolveNativeWorkspaceMode([synthetic, synthetic], fixture)).toEqual({
      provenance: 'synthetic_fixture',
      writable: fixture,
    });
  });
  it('allows normal live operation and rejects opening live research under the fixture flag', () => {
    expect(resolveNativeWorkspaceMode([live, live], false)).toEqual({
      provenance: 'live_provider',
      writable: true,
    });
    expect(() => resolveNativeWorkspaceMode([live], true)).toThrow(/live.*fixture/i);
  });
  it.each<Origin[]>([[{}], [{}, synthetic], [{}, live], [synthetic, live]])(
    'makes mixed or untagged origins read-only and refuses fixture dispatch (%j)',
    (...runs) => {
      const before = JSON.stringify(runs);
      expect(resolveNativeWorkspaceMode(runs, false)).toEqual({
        provenance: 'unclassified',
        writable: false,
      });
      expect(() => resolveNativeWorkspaceMode(runs, true)).toThrow(/unclassified|mixed/i);
      expect(JSON.stringify(runs)).toBe(before);
    },
  );
});
