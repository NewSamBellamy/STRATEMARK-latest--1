import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { LinkCandidate, MarketIntelRepository } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { useAgentTrace } from '@/lib/agentic/agentTrace';
import { AddFromLink } from './AddFromLink';

const SUNRUN: LinkCandidate = {
  status: 'identified', kind: 'article', name: 'Sunrun', websiteUrl: 'https://sunrun.com',
  descriptor: 'residential solar',
  sources: [{ url: 'https://news.example.org/sunrun-raises', title: 'Sunrun raises new funding', how: 'page' }],
};

function repoWith(answer: LinkCandidate) {
  const repo = makeRepo();
  const identify = vi.fn(async () => answer);
  const followCompanies = vi.fn(async () => undefined);
  const createResearchedDeck = vi.spyOn(repo, 'createResearchedDeck');
  const expandDeck = vi.spyOn(repo, 'expandDeck');
  Object.assign(repo, { identifyCompanyFromLink: identify, followCompanies });
  return { repo: repo as MarketIntelRepository, identify, createResearchedDeck, expandDeck };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderEntry(repository: MarketIntelRepository, onStartDeck = vi.fn()) {
  const view = renderWithProviders(
    <Routes>
      <Route path="*" element={<><AddFromLink onStartDeck={onStartDeck} /><Where /></>} />
    </Routes>,
    { repository },
  );
  return { ...view, onStartDeck };
}

async function readLink(user: ReturnType<typeof renderWithProviders>['user'], url = 'https://news.example.org/sunrun-raises') {
  await user.click(screen.getByRole('button', { name: 'Add one from a link' }));
  await user.type(screen.getByLabelText(/Link to a post/), url);
  await user.click(screen.getByRole('button', { name: 'Find the company' }));
}

beforeEach(() => useAgentTrace.setState({ jobs: [], events: [] }));

describe('Add a company from a link', () => {
  it('is not offered where the engine cannot read links', () => {
    renderEntry(makeRepo());
    expect(screen.queryByRole('button', { name: 'Add one from a link' })).not.toBeInTheDocument();
  });

  it('shows the candidate with its source and spends or saves nothing until a choice is made', async () => {
    const { repo, identify, createResearchedDeck, expandDeck } = repoWith(SUNRUN);
    const { user } = renderEntry(repo);
    await readLink(user);
    expect(await screen.findByText('Sunrun')).toBeInTheDocument();
    expect(screen.getByText(/residential solar/)).toBeInTheDocument();
    const source = screen.getByRole('link', { name: 'Sunrun raises new funding' });
    expect(source).toHaveAttribute('href', 'https://news.example.org/sunrun-raises');
    expect(identify).toHaveBeenCalledWith({ url: 'https://news.example.org/sunrun-raises' });
    expect(createResearchedDeck).not.toHaveBeenCalled();
    expect(expandDeck).not.toHaveBeenCalled();
    expect(useAgentTrace.getState().jobs).toEqual([]);
  });

  it('adds the confirmed company to a chosen deck through the hunt queue, with Today when asked', async () => {
    const { repo } = repoWith(SUNRUN);
    const { user } = renderEntry(repo);
    await readLink(user);
    await screen.findByText('Sunrun');
    const decks = await screen.findAllByRole('option');
    expect(decks.length).toBeGreaterThan(1);
    const target = decks[1] as HTMLOptionElement;
    await user.selectOptions(screen.getByLabelText('Deck to add to'), target.value);
    await user.click(screen.getByLabelText('Also add it to Today'));
    await user.click(screen.getByRole('button', { name: 'Add to this deck' }));
    const jobs = useAgentTrace.getState().jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      marketId: target.value, followAfter: true,
      focus: { company: { name: 'Sunrun', domain: 'https://sunrun.com', descriptor: 'residential solar' } },
    });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/markets/${target.value}/deck`));
  });

  it('starts a new deck for the company', async () => {
    const { repo } = repoWith(SUNRUN);
    const { user, onStartDeck } = renderEntry(repo);
    await readLink(user);
    await screen.findByText('Sunrun');
    await user.click(screen.getByRole('button', { name: 'Start a new deck' }));
    expect(onStartDeck).toHaveBeenCalledWith('Sunrun', false);
    expect(useAgentTrace.getState().jobs).toEqual([]);
  });

  it('lets the person say it is not this company, and then type the name', async () => {
    const { repo } = repoWith(SUNRUN);
    const { user, onStartDeck } = renderEntry(repo);
    await readLink(user);
    await screen.findByText('Sunrun');
    await user.click(screen.getByRole('button', { name: 'Not this company' }));
    await user.type(screen.getByLabelText('Company name'), 'Enphase Energy');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enphase Energy')).toBeInTheDocument();
    expect(screen.getByText('Source: you typed this name.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start a new deck' }));
    expect(onStartDeck).toHaveBeenCalledWith('Enphase Energy', false);
  });

  it('never guesses: an unidentified link asks for the company name', async () => {
    const { repo } = repoWith({ status: 'unidentified', kind: 'x_post', reason: 'Could not tell which company that is. Type the company name.' });
    const { user, onStartDeck } = renderEntry(repo);
    await readLink(user, 'https://x.com/someone/status/1234567890123');
    expect(await screen.findByText(/Type the company name/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a new deck' })).not.toBeInTheDocument();
    expect(onStartDeck).not.toHaveBeenCalled();
    expect(useAgentTrace.getState().jobs).toEqual([]);
  });

  it('says so when the link cannot be read at all, and keeps the link for another try', async () => {
    const { repo, identify } = repoWith(SUNRUN);
    identify.mockRejectedValueOnce(new Error('Network down'));
    const { user } = renderEntry(repo);
    await readLink(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.getByLabelText(/Link to a post/)).toHaveValue('https://news.example.org/sunrun-raises');
  });
});
