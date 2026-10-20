import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { GeminiRepository } from '@mi/research';
import { importQuestion } from './importSummary';
import { installBrowserResearch, installResearchImport, openBrowserResearchStore, planResearchImport, readBrowserResearchData } from './browserResearchStore';
import { deckNames, market, real, unavailable, workspace } from './importTestKit';

const MINE = 'MY OWN PRECIOUS RESEARCH';
const SAMPLE_DECK = 'Frontier AI Ecosystem';
const mine = () => workspace(market('m_mine', MINE));

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** One ordinary save in whatever workspace is stored, the way using the app makes them. */
async function oneOrdinarySave() {
  const repository = new GeminiRepository({ apiKey: 'k', client: { ground: async () => { throw new Error('offline'); }, structure: async () => { throw new Error('offline'); } } as never,
    store: await openBrowserResearchStore(), dashboardWarmup: false, originalSourceReader: unavailable } as never);
  await repository.ready();
  const [first] = await repository.listMarkets();
  await repository.updateMarketCadence(first!.id, 'daily');
}

describe('the research an import replaces is kept where no ordinary save reaches it', () => {
  it('survives a save in the imported workspace, which is when the backup stops being the person\'s research', async () => {
    await (await openBrowserResearchStore()).write(mine());
    await installBrowserResearch(JSON.stringify(real()));
    const afterImport = await readBrowserResearchData();
    expect(deckNames(afterImport.current)).toEqual([SAMPLE_DECK]);
    expect(deckNames(afterImport.backup)).toEqual([MINE]);
    expect(deckNames(afterImport.beforeImport)).toEqual([MINE]);

    await oneOrdinarySave();
    await oneOrdinarySave();
    const afterSaves = await readBrowserResearchData();
    // The backup is now the import itself: the person's research is gone from it.
    expect(deckNames(afterSaves.backup)).toEqual([SAMPLE_DECK]);
    expect(deckNames(afterSaves.beforeImport)).toEqual([MINE]);
  });

  it('is restored by the person on request, and is then spent', async () => {
    await (await openBrowserResearchStore()).write(mine());
    await installBrowserResearch(JSON.stringify(real()));
    await oneOrdinarySave();
    const plan = planResearchImport((await readBrowserResearchData()).beforeImport!);
    await installResearchImport(plan, { kind: 'before-import' });
    const restored = await readBrowserResearchData();
    expect(deckNames(restored.current)).toEqual([MINE]);
    expect(restored.beforeImport).toBeNull();
    // What was replaced by the restore is still reachable as the backup, until the next save.
    expect(deckNames(restored.backup)).toEqual([SAMPLE_DECK]);
  });

  it('is replaced only by the next import, which keeps what was current then', async () => {
    await (await openBrowserResearchStore()).write(mine());
    await installBrowserResearch(JSON.stringify(real()));
    expect(deckNames((await readBrowserResearchData()).beforeImport)).toEqual([MINE]);
    const second = real();
    (second.markets[0] as unknown as { name: string }).name = 'Second file';
    await installBrowserResearch(JSON.stringify(second));
    const saved = await readBrowserResearchData();
    expect(deckNames(saved.current)).toEqual(['Second file']);
    expect(deckNames(saved.beforeImport)).toEqual([SAMPLE_DECK]);
  });

  it('is not replaced by a workspace with no decks in it', async () => {
    await (await openBrowserResearchStore()).write(mine());
    await installBrowserResearch(JSON.stringify(real()));
    const store = await openBrowserResearchStore();
    await store.write(workspace());
    await installBrowserResearch(JSON.stringify(real()));
    expect(deckNames((await readBrowserResearchData()).beforeImport)).toEqual([MINE]);
  });

  it('is not made when there was no research to keep', async () => {
    await installBrowserResearch(JSON.stringify(real()));
    expect((await readBrowserResearchData()).beforeImport).toBeNull();
  });

  it('is not touched by restoring the backup, which is not an import', async () => {
    await (await openBrowserResearchStore()).write(mine());
    await installBrowserResearch(JSON.stringify(real()));
    const plan = planResearchImport((await readBrowserResearchData()).backup!);
    await installResearchImport(plan, { kind: 'backup' });
    const saved = await readBrowserResearchData();
    expect(deckNames(saved.current)).toEqual([MINE]);
    expect(deckNames(saved.beforeImport)).toEqual([MINE]);
  });
});

describe('the confirmation says what is kept and what the app may do', () => {
  const plan = { decks: 1, companies: 10, skipped: 0, unfinishedResearch: 0, followsLeftOut: 0 };

  it('does not promise the backup for an import, and names the separate copy and how long it lasts', () => {
    const asked = importQuestion(plan, 'this export');
    expect(asked).not.toMatch(/will become the backup/);
    expect(asked).toContain('Your current research is kept as a separate copy from before the import, and Settings can restore it until you import another file.');
    expect(importQuestion(plan, 'this export', { replacesEarlierCopy: true })).toContain('That replaces the copy you kept from your last import.');
  });

  it('says that an imported deck refreshes and fills in figures like any other, unless background research is paused', () => {
    const asked = importQuestion(plan, 'this export');
    expect(asked).not.toMatch(/nothing is researched until you ask/i);
    expect(asked).toContain('unless background research is paused, the app can refresh a deck that is due and fill in missing figures when you open one.');
  });

  it('says only that the backup lasts until the next change when restoring a copy', () => {
    for (const kind of ['backup', 'before-import'] as const) {
      const asked = importQuestion(plan, 'the saved backup', { kind });
      expect(asked).toContain('Your current research stays available as the backup until you next make a change.');
      expect(asked).not.toContain('separate copy');
    }
  });

  it('says that followed companies are not brought in, with how many', () => {
    expect(importQuestion({ ...plan, followsLeftOut: 3 }, 'this export')).toContain('3 followed companies in the file are not brought in. Follow them again from Today if you want them.');
  });
});
