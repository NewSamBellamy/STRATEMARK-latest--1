import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { TaskToasts } from '@/components/layout/TaskToasts';
import ReportViewerPage from './ReportViewerPage';
import { ExportMenu } from '@/features/export/ExportMenu';

async function firstCompany(repository: ReturnType<typeof makeRepo>) {
  const [market] = await repository.listMarkets();
  const deck = await repository.getDeckByMarket(market!.id);
  const cards = await repository.listCards(deck!.id);
  const entity = cards.find((c) => c.company && c.card.cardType === 'company')!;
  return entity.company!;
}

describe('creating a company report', () => {
  it('runs in the background and tells the user when it is ready, with a way to open it', async () => {
    const repository = makeRepo();
    const company = await firstCompany(repository);
    const { user } = renderWithProviders(
      <>
        <ExportMenu report={{ kind: 'company', subjectId: company.id, name: company.name }} company={{ id: company.id, name: company.name, oneLiner: null, hq: null, website: null, logoUrl: null, tier: null, metrics: [] }} />
        <TaskToasts />
      </>,
      { repository },
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    await user.click(screen.getByRole('menuitem', { name: /create report/i }));
    await user.click(screen.getByRole('button', { name: 'Create report' }));
    expect(await screen.findByText(`Report: ${company.name}`)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Open report' })).toHaveAttribute('href', expect.stringMatching(/^\/reports\/rpt_/));
  });

  it('says so plainly when the report cannot be created', async () => {
    const repository = makeRepo();
    const company = await firstCompany(repository);
    vi.spyOn(repository, 'generateReport').mockRejectedValue(new Error('Add a Gemini key to research the gaps.'));
    const { user } = renderWithProviders(
      <>
        <ExportMenu report={{ kind: 'company', subjectId: company.id, name: company.name }} company={{ id: company.id, name: company.name, oneLiner: null, hq: null, website: null, logoUrl: null, tier: null, metrics: [] }} />
        <TaskToasts />
      </>,
      { repository },
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    await user.click(screen.getByRole('menuitem', { name: /create report/i }));
    await user.click(screen.getByRole('button', { name: 'Create report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a Gemini key to research the gaps.');
  });

  it('keeps the picker from starting with no sections', async () => {
    const repository = makeRepo();
    const company = await firstCompany(repository);
    const { user } = renderWithProviders(
      <ExportMenu report={{ kind: 'company', subjectId: company.id, name: company.name }} company={{ id: company.id, name: company.name, oneLiner: null, hq: null, website: null, logoUrl: null, tier: null, metrics: [] }} />,
      { repository },
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    await user.click(screen.getByRole('menuitem', { name: /create report/i }));
    for (const box of screen.getAllByRole('checkbox')) if ((box as HTMLInputElement).checked) await user.click(box);
    expect(screen.getByRole('button', { name: 'Create report' })).toBeDisabled();
    expect(screen.getByText('Pick at least one section.')).toBeInTheDocument();
  });
});

describe('opening a finished company report', () => {
  it('shows a section for each topic asked for, the gaps and the footnotes', async () => {
    const repository = makeRepo();
    const company = await firstCompany(repository);
    const report = await repository.generateReport({ kind: 'company', subjectId: company.id, topics: ['overview', 'metrics', 'team_org'] });
    renderWithProviders(
      <Routes><Route path="/reports/:reportId" element={<ReportViewerPage />} /></Routes>,
      { repository, route: `/reports/${report.id}` },
    );
    expect(await screen.findByRole('heading', { level: 2, name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Metrics/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Team & org/ })).toBeInTheDocument();
    expect(screen.getByText(/Demo report/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share & export' })).toBeInTheDocument());
  });

  it('offers PDF, Markdown and JSON from the one menu', async () => {
    const repository = makeRepo();
    const company = await firstCompany(repository);
    const report = await repository.generateReport({ kind: 'company', subjectId: company.id, topics: ['overview'] });
    const { user } = renderWithProviders(
      <Routes><Route path="/reports/:reportId" element={<ReportViewerPage />} /></Routes>,
      { repository, route: `/reports/${report.id}` },
    );
    await user.click(await screen.findByRole('button', { name: 'Share & export' }));
    expect(screen.getByRole('menuitem', { name: /^PDF/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Markdown/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^JSON/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /share link/i })).toBeInTheDocument();
  });
});
