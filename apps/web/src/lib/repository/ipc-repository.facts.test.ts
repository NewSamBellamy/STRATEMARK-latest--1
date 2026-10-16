import { expect, it, vi } from 'vitest';
import type { PreloadRepositoryApi } from '@mi/contracts';
import { IpcRepository } from './ipc-repository';

it('uses the native accepted-facts channel and never substitutes raw observations', async () => {
  const facts = vi.fn().mockResolvedValue([]);
  const raw = vi.fn();
  const repo = new IpcRepository({ getCompanyFacts: facts, getCompanyMetrics: raw } as unknown as PreloadRepositoryApi);
  expect(await repo.getCompanyFacts('cmp')).toEqual([]);
  expect(facts).toHaveBeenCalledWith('cmp');
  expect(raw).not.toHaveBeenCalled();
});

it('batches face-slot hunts over the desktop channel, and an older host batches nothing', async () => {
  const batch = vi.fn().mockResolvedValue({ cmp: { filledTypes: [], metrics: [], retieredCardIds: [] } });
  const repo = new IpcRepository({ huntFaceSlotsBatch: batch } as unknown as PreloadRepositoryApi);
  expect(Object.keys(await repo.huntFaceSlotsBatch(['cmp', 'cmp2']))).toEqual(['cmp']);
  expect(batch).toHaveBeenCalledWith(['cmp', 'cmp2']);
  // Nothing batched: the sweep hunts each company alone, as before.
  expect(await new IpcRepository({} as unknown as PreloadRepositoryApi).huntFaceSlotsBatch(['cmp'])).toEqual({});
});

it('asks to restart an older desktop host instead of trusting its legacy metric labels', async () => {
  const raw = vi.fn();
  const repo = new IpcRepository({ getCompanyMetrics: raw } as unknown as PreloadRepositoryApi);
  await expect(repo.getCompanyFacts('cmp')).rejects.toThrow(/restart/i);
  expect(raw).not.toHaveBeenCalled();
});
