import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { CollectibleCard } from './CollectibleCard';
import { heroCandidates } from './useSignalHero';

const covers = vi.hoisted(() => ({ getRealCover: vi.fn() }));
vi.mock('@/lib/media/realCover', () => ({ getRealCover: covers.getRealCover }));

const data = buildDataset();
const base = data.cards.find((c) => c.cardType === 'insight')!;
const cite = (url: string, credibility: 'primary' | 'reputable_secondary' | 'unknown') => ({ title: url, url, credibility });
const withCitations = (cardType: 'insight' | 'barrier', citations: ReturnType<typeof cite>[], company: CardWithCompany['company'] = null): CardWithCompany =>
  ({ card: { ...base, cardType, citations }, company, metrics: [], viceClaims: [] });

beforeEach(() => covers.getRealCover.mockReset());

describe('heroCandidates', () => {
  it('orders a card\'s sources best first, drops duplicates and insecure addresses, and tries at most three pages', () => {
    const found = heroCandidates(withCitations('insight', [
      cite('https://blog.example.com/a', 'unknown'),
      cite('https://reuters.com/b', 'reputable_secondary'),
      cite('http://insecure.example.com/c', 'primary'),
      cite('https://sec.gov/d', 'primary'),
      cite('https://reuters.com/b', 'reputable_secondary'),
      cite('https://other.example.com/e', 'unknown'),
    ]));
    expect(found.map((c) => c.url)).toEqual(['https://sec.gov/d', 'https://reuters.com/b', 'https://blog.example.com/a']);
  });
});

describe('a signal card\'s hero picture', () => {
  it('shows the picture its source published, credited to the publisher', async () => {
    covers.getRealCover.mockResolvedValue({ src: 'https://cdn.example.com/hero.jpg', publisher: 'reuters.com' });
    renderWithProviders(<CollectibleCard data={withCitations('insight', [cite('https://reuters.com/story', 'reputable_secondary')])} />);
    const img = await screen.findByTestId('signal-hero');
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/hero.jpg');
    expect(screen.getByText('reuters.com')).toBeInTheDocument();
  });

  it('moves on to the next source when the first page publishes no picture', async () => {
    covers.getRealCover.mockResolvedValueOnce(null).mockResolvedValueOnce({ src: 'https://cdn.example.com/second.jpg', publisher: null });
    renderWithProviders(<CollectibleCard data={withCitations('barrier', [cite('https://sec.gov/x', 'primary'), cite('https://reuters.com/y', 'reputable_secondary')])} />);
    expect(await screen.findByTestId('signal-hero')).toHaveAttribute('src', 'https://cdn.example.com/second.jpg');
    expect(covers.getRealCover).toHaveBeenCalledTimes(2);
  });

  it('keeps the default art when no source has a picture', async () => {
    covers.getRealCover.mockResolvedValue(null);
    renderWithProviders(<CollectibleCard data={withCitations('insight', [cite('https://reuters.com/story', 'reputable_secondary')])} />);
    await waitFor(() => expect(covers.getRealCover).toHaveBeenCalled());
    expect(screen.queryByTestId('signal-hero')).not.toBeInTheDocument();
  });

  it('never looks for a hero on a company card', () => {
    const company = data.cards.find((c) => c.cardType === 'company')!;
    renderWithProviders(<CollectibleCard data={{ card: company, company: data.companies.find((c) => c.id === company.companyId)!, metrics: [], viceClaims: [] }} />);
    expect(covers.getRealCover).not.toHaveBeenCalled();
  });
});
