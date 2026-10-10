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

it('asks to restart an older desktop host instead of trusting its legacy metric labels', async () => {
  const raw = vi.fn();
  const repo = new IpcRepository({ getCompanyMetrics: raw } as unknown as PreloadRepositoryApi);
  await expect(repo.getCompanyFacts('cmp')).rejects.toThrow(/restart/i);
  expect(raw).not.toHaveBeenCalled();
});
