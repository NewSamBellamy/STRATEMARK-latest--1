import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { CardMemory, Report, ResearchThread } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { ReportWizard } from './ReportWizard';
import { reportSuggestions } from './reportSuggestions';
import { useCompanyReportRun } from './useCompanyReportRun';
import { DeepDiveProviderWithPanel, useDeepDive } from '@/features/deepdive/DeepDive';
import { Route, Routes } from 'react-router-dom';

function thread(id: string, title: string, updatedAt = '2026-10-01T00:00:00.000Z', companyId: string | null = 'co_1'): ResearchThread {
  return {
    id,
    scope: { kind: 'company', deckId: null, companyId, subject: 'Acme' },
    title,
    messages: [
      { id: `${id}_u`, role: 'user', text: title, citations: [], at: updatedAt },
      { id: `${id}_a`, role: 'assistant', text: 'An answer.', citations: [], at: updatedAt },
    ],
    reportId: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

function memoryWith(threads: ResearchThread[], reports: Report[] = []): CardMemory {
  return { cardId: 'card_1', threads, reports, brief: null };
}

function repoWithMemory(memory: CardMemory) {
  const repository = makeRepo();
  const getCardMemory = vi.fn(async () => memory);
  Object.assign(repository, { getCardMemory });
  return { repository, getCardMemory };
}

const THREADS = [
  thread('thr_new', 'Pricing pressure from rivals', '2026-10-03T00:00:00.000Z'),
  thread('thr_old', 'Who runs the company', '2026-10-01T00:00:00.000Z'),
  thread('thr_mid', 'Funding history', '2026-10-02T00:00:00.000Z'),
];

function Harness({ onStart }: { onStart: (input: unknown) => void }) {
  return (
    <ReportWizard open onOpenChange={() => {}} companyId="co_1" companyName="Acme" cardId="card_1" onStart={onStart} />
  );
}

describe('the report wizard steps', () => {
  it('walks Focus, Sections, Start with Back and Next, each step starting at its heading', async () => {
    const { repository } = repoWithMemory(memoryWith(THREADS));
    const { user } = renderWithProviders(<Harness onStart={() => {}} />, { repository });
    const first = await screen.findByRole('heading', { level: 3, name: /Step 1 of 3/ });
    expect(screen.getByRole('dialog', { name: /Create a report on Acme/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Everything on this card/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /One conversation/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /A topic/ })).toBeInTheDocument();
    expect(first).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    const second = screen.getByRole('heading', { level: 3, name: /Step 2 of 3/ });
    await waitFor(() => expect(second).toHaveFocus());
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(5);

    await user.click(screen.getByRole('button', { name: /Next/ }));
    const third = screen.getByRole('heading', { level: 3, name: /Step 3 of 3/ });
    await waitFor(() => expect(third).toHaveFocus());
    expect(screen.getByText(/Using the 3 conversations and the research on file, plus fresh research for gaps\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start report/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: /Step 2 of 3/ })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByRole('heading', { level: 3, name: /Step 1 of 3/ })).toBeInTheDocument();
  });

  it('can be driven from the keyboard alone', async () => {
    const onStart = vi.fn();
    const { repository } = repoWithMemory(memoryWith(THREADS));
    const { user } = renderWithProviders(<Harness onStart={onStart} />, { repository });
    await screen.findByRole('heading', { level: 3, name: /Step 1 of 3/ });
    screen.getByRole('radio', { name: /A topic/ }).focus();
    await user.keyboard(' ');
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'who they compete with');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 3, name: /Step 2 of 3/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Start report/ }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ focus: 'who they compete with' }));
  });

  it('keeps Next off until a topic is typed, and until a section is ticked', async () => {
    const { repository } = repoWithMemory(memoryWith(THREADS));
    const { user } = renderWithProviders(<Harness onStart={() => {}} />, { repository });
    await user.click(await screen.findByRole('radio', { name: /A topic/ }));
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'pricing');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    for (const box of screen.getAllByRole('checkbox')) if ((box as HTMLInputElement).checked) await user.click(box);
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    expect(screen.getByText('Pick at least one section.')).toBeInTheDocument();
  });

  it('preselects sections that fit the chosen focus', async () => {
    const { repository } = repoWithMemory(memoryWith(THREADS));
    const { user } = renderWithProviders(<Harness onStart={() => {}} />, { repository });
    await user.click(await screen.findByRole('radio', { name: /A topic/ }));
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'recent news about the founders');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('checkbox', { name: /Live intel|News|Recent news/i })).toBeChecked();
    const ticked = screen.getAllByRole('checkbox').filter((b) => (b as HTMLInputElement).checked);
    expect(ticked.length).toBeLessThan(screen.getAllByRole('checkbox').length);
  });
});

describe('the wizard suggestions', () => {
  it('are built with no model call and offer the latest conversations first', async () => {
    const { repository } = repoWithMemory(memoryWith(THREADS));
    const askResearch = vi.spyOn(repository, 'askResearch' as never);
    const generateReport = vi.spyOn(repository, 'generateReport');
    renderWithProviders(<Harness onStart={() => {}} />, { repository });
    expect(await screen.findByRole('button', { name: /Turn this conversation into a report: Pricing pressure from rivals/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Turn this conversation into a report: Funding history/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Who runs the company/ })).not.toBeInTheDocument();
    expect(askResearch).not.toHaveBeenCalled();
    expect(generateReport).not.toHaveBeenCalled();
  });

  it('offer no conversation titles when the card has no conversations', async () => {
    const { repository } = repoWithMemory(memoryWith([]));
    const { user } = renderWithProviders(<Harness onStart={() => {}} />, { repository });
    await screen.findByRole('heading', { level: 3, name: /Step 1 of 3/ });
    expect(screen.queryByRole('button', { name: /Turn this conversation/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /One conversation/ })).toBeDisabled();
    expect(screen.getByText('No conversations on this card yet')).toBeInTheDocument();
    // A topic with no stored research is still suggested, and picking it fills the topic box.
    await user.click(screen.getByRole('button', { name: /Add research on/ }));
    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Recent news and what people are saying');
  });

  it('turn a conversation suggestion into "One conversation" with it chosen', async () => {
    const { repository } = repoWithMemory(memoryWith(THREADS));
    const { user } = renderWithProviders(<Harness onStart={() => {}} />, { repository });
    await user.click(await screen.findByRole('button', { name: /Funding history/ }));
    expect(screen.getByRole('radio', { name: /One conversation/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Conversation' })).toHaveValue('thr_mid');
  });
});

describe('reportSuggestions', () => {
  it('returns at most three, without a model, from what exists', () => {
    const out = reportSuggestions(memoryWith(THREADS), { subjectName: 'Acme', peerNames: ['Beta', 'Gamma'] });
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.kind)).toEqual(['thread', 'topic', 'compare']);
    expect(out[2]!.label).toBe('Compare Acme with Beta');
  });

  it('skips a comparison when the deck has no other cards, and a topic already reported on', () => {
    const none = reportSuggestions(null, { subjectName: 'Acme', peerNames: [] });
    expect(none.every((s) => s.kind === 'topic')).toBe(true);
    const everything = reportSuggestions({ threads: [], reports: [{ topics: ['live_intel', 'team_org', 'products_roadmap', 'mission_governance', 'history', 'metrics'] } as Report] });
    expect(everything).toEqual([]);
  });

  it('ignores a conversation with nothing in it', () => {
    const empty = { ...thread('thr_empty', 'Empty'), messages: [] };
    expect(reportSuggestions({ threads: [empty], reports: [] }).some((s) => s.kind === 'thread')).toBe(false);
  });
});

describe('what the wizard asks the report to do', () => {
  function Runner() {
    const run = useCompanyReportRun();
    return (
      <ReportWizard
        open
        onOpenChange={() => {}}
        companyId="co_1"
        companyName="Acme"
        cardId="card_1"
        onStart={(input) => { void run({ companyId: 'co_1', companyName: 'Acme', ...input }); }}
      />
    );
  }

  async function finish(user: ReturnType<typeof renderWithProviders>['user']) {
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Start report/ }));
  }

  function setup() {
    const { repository } = repoWithMemory(memoryWith(THREADS));
    const generateReport = vi.spyOn(repository, 'generateReport');
    return { generateReport, ...renderWithProviders(<Runner />, { repository }) };
  }

  it('Everything: the card, all of its conversations, no focus text', async () => {
    const { user, generateReport } = setup();
    await screen.findByText(/All 3 conversations/);
    await finish(user);
    expect(generateReport).toHaveBeenCalledTimes(1);
    const request = generateReport.mock.calls[0]![0];
    expect(request).toMatchObject({ kind: 'company', subjectId: 'co_1', cardId: 'card_1', focus: null });
    expect([...request.threadIds!].sort()).toEqual(['thr_mid', 'thr_new', 'thr_old']);
    expect(request.topics).not.toContain('sources');
    expect(request.topics!.length).toBeGreaterThan(3);
  });

  it('One conversation: only the chosen conversation, its title as the focus', async () => {
    const { user, generateReport } = setup();
    await user.click(await screen.findByRole('radio', { name: /One conversation/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conversation' }), 'thr_old');
    await finish(user);
    expect(generateReport.mock.calls[0]![0]).toMatchObject({
      cardId: 'card_1', threadIds: ['thr_old'], focus: 'Who runs the company', topics: ['overview', 'metrics', 'live_intel'],
    });
  });

  it('A topic: no conversations, the typed topic as the focus', async () => {
    const { user, generateReport } = setup();
    await user.click(await screen.findByRole('radio', { name: /A topic/ }));
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), '  pricing pressure  ');
    await finish(user);
    expect(generateReport.mock.calls[0]![0]).toMatchObject({ cardId: 'card_1', threadIds: [], focus: 'pricing pressure' });
    expect(generateReport.mock.calls[0]![0].topics).toContain('products_roadmap');
  });

  it('falls back to the listed conversations when the engine has no card memory', async () => {
    const repository = makeRepo();
    Object.assign(repository, { listResearchThreads: vi.fn(async () => THREADS) });
    const generateReport = vi.spyOn(repository, 'generateReport');
    const { user } = renderWithProviders(<Runner />, { repository });
    await screen.findByText(/All 3 conversations/);
    await finish(user);
    expect(generateReport.mock.calls[0]![0].threadIds).toHaveLength(3);
  });
});

describe('"Save this chat as a report"', () => {
  function Opener() {
    const { chat } = useDeepDive();
    return <button type="button" onClick={() => chat({ kind: 'company', deckId: null, companyId: 'co_1', subject: 'Acme' }, { seed: 'What is Acme pricing?' })}>open chat</button>;
  }

  it('opens the wizard with this conversation chosen, and the old inline form is gone', async () => {
    const repository = makeRepo();
    Object.assign(repository, { saveThreadAsReport: vi.fn() });
    const generateReport = vi.spyOn(repository, 'generateReport');
    const { user } = renderWithProviders(
      <DeepDiveProviderWithPanel><Routes><Route path="*" element={<Opener />} /></Routes></DeepDiveProviderWithPanel>,
      { repository },
    );
    await user.click(screen.getByRole('button', { name: 'open chat' }));
    await user.click(await screen.findByRole('button', { name: 'Share and export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Save this chat as a report' }));

    expect(await screen.findByRole('heading', { level: 3, name: /Step 1 of 3/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /One conversation/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Conversation' })).toHaveDisplayValue(/Acme pricing/);
    // The old one-line form is not rendered any more.
    expect(screen.queryByRole('textbox', { name: 'Report focus' })).not.toBeInTheDocument();
    expect(document.getElementById('report-focus')).toBeNull();
    expect(generateReport).not.toHaveBeenCalled();
  });
});
