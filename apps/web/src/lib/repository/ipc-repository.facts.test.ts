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

it('the desktop sweep gets its free steps: saved-figure recovery and a twin company\'s evidence', async () => {
  const recover = vi.fn().mockResolvedValue({ filledTypes: ['employees'], metrics: [], retieredCardIds: [] });
  const reuse = vi.fn().mockResolvedValue(3);
  const repo = new IpcRepository({ recoverSavedCompanyMetrics: recover, reuseCompanyEvidence: reuse } as unknown as PreloadRepositoryApi);
  expect((await repo.recoverSavedCompanyMetrics('cmp')).filledTypes).toEqual(['employees']);
  expect(await repo.reuseCompanyEvidence('cmp')).toBe(3);
  expect(recover).toHaveBeenCalledWith('cmp');
  expect(reuse).toHaveBeenCalledWith('cmp');
  // An older host: nothing is lent, and recovery fails so the sweep's paid hunt still runs.
  const old = new IpcRepository({} as unknown as PreloadRepositoryApi);
  expect(await old.reuseCompanyEvidence('cmp')).toBe(0);
  await expect(old.recoverSavedCompanyMetrics('cmp')).rejects.toThrow(/desktop shell/i);
});

it('asks to restart an older desktop host instead of trusting its legacy metric labels', async () => {
  const raw = vi.fn();
  const repo = new IpcRepository({ getCompanyMetrics: raw } as unknown as PreloadRepositoryApi);
  await expect(repo.getCompanyFacts('cmp')).rejects.toThrow(/restart/i);
  expect(raw).not.toHaveBeenCalled();
});

it('shows the desktop host\'s archive refusal in plain words, without Electron\'s wrapper', async () => {
  const refuse = vi.fn().mockRejectedValue(new Error(
    "Error invoking remote method 'mi:setMarketArchived': Error: This deck is still being researched. You can archive it once research finishes."));
  const repo = new IpcRepository({ setMarketArchived: refuse } as unknown as PreloadRepositoryApi);
  await expect(repo.setMarketArchived('mkt', true)).rejects.toThrow(
    /^This deck is still being researched\. You can archive it once research finishes\.$/);
});
