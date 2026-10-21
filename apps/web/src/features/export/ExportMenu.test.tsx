import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { ExportMenu } from './ExportMenu';

const company = { id: 'co_1', name: 'Acme', oneLiner: null, hq: null, website: null, logoUrl: null, tier: null, metrics: [] };

describe('the Share & export menu', () => {
  it('groups Create, Share and Download in one panel', async () => {
    const { user } = renderWithProviders(
      <ExportMenu
        company={company}
        report={{ kind: 'company', subjectId: 'co_1', name: 'Acme' }}
        share={{ title: 'Acme', build: async () => { throw new Error('not built in this test'); } }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    expect(await screen.findByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Share')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /create report/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /share link/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /company report \(pdf\)/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /data \(csv\)/i })).toBeInTheDocument();
  });

  it('shows only the groups the page can honestly offer', async () => {
    const { user } = renderWithProviders(<ExportMenu company={company} />);
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    expect(screen.queryByRole('menuitem', { name: /create report/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /share link/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /data \(csv\)/i })).toBeInTheDocument();
  });

  it('hides Create report where the engine cannot compose reports', async () => {
    const repository = makeRepo();
    const capabilities = repository.capabilities!();
    repository.capabilities = () => ({ ...capabilities, unsupported: ['generateReport'] });
    const { user } = renderWithProviders(
      <ExportMenu company={company} report={{ kind: 'company', subjectId: 'co_1', name: 'Acme' }} />,
      { repository },
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    expect(screen.queryByRole('menuitem', { name: /create report/i })).not.toBeInTheDocument();
  });

  it('opens the share dialog from Share link and packages the payload there', async () => {
    const build = vi.fn(async () => { throw new Error('Nothing to share in this test'); });
    const { user } = renderWithProviders(<ExportMenu company={company} share={{ title: 'Acme', subtitle: 'Snapshot', build }} />);
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    await user.click(screen.getByRole('menuitem', { name: /share link/i }));
    await waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens the section picker for a company report and starts it in the background', async () => {
    const repository = makeRepo();
    const generate = vi.spyOn(repository, 'generateReport');
    const { user } = renderWithProviders(
      <ExportMenu company={company} report={{ kind: 'company', subjectId: 'co_1', name: 'Acme' }} />,
      { repository },
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    await user.click(screen.getByRole('menuitem', { name: /create report/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Step 1 focus, then step 2: sections are preselected from the topic.
    await user.click(screen.getByRole('radio', { name: /A topic/ }));
    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'pricing');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('checkbox', { name: /Products/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /history/i })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Start report/ }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const request = generate.mock.calls[0]![0];
    expect(request).toMatchObject({ kind: 'company', subjectId: 'co_1', focus: 'pricing' });
    expect(request.topics).toContain('overview');
    expect(request.topics).toContain('products_roadmap');
    expect(request.topics).not.toContain('history');
    expect(request.topics).not.toContain('sources');
  });

  it('composes a deck report with an optional focus', async () => {
    const repository = makeRepo();
    const generate = vi.spyOn(repository, 'generateReport');
    const { user } = renderWithProviders(
      <ExportMenu company={company} report={{ kind: 'deck', subjectId: 'dk_1' }} />,
      { repository },
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    await user.click(screen.getByRole('menuitem', { name: /create report/i }));
    await user.type(screen.getByLabelText(/focus/i), 'pricing');
    await user.click(screen.getByRole('button', { name: 'Compose' }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ kind: 'deck', subjectId: 'dk_1', focus: 'pricing' }));
  });

  it('lets a host add its own downloads and runs the one picked', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <ExportMenu downloads={[{ key: 'md', label: 'Markdown', icon: 'markdown', onSelect }]} />,
    );
    await user.click(screen.getByRole('button', { name: 'Share & export' }));
    await user.click(screen.getByRole('menuitem', { name: 'Markdown' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the page has nothing to share, create or download', () => {
    const { container } = renderWithProviders(<ExportMenu />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('is a single icon button in a panel header, named for what it does', async () => {
    const { user } = renderWithProviders(
      <ExportMenu variant="icon" transcript={{ title: 'Chat', messages: [] }} report={{ label: 'Save this chat as a report', onClick: () => {} }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Share and export' }));
    expect(screen.getByRole('menuitem', { name: 'Save this chat as a report' })).toBeInTheDocument();
  });
});
