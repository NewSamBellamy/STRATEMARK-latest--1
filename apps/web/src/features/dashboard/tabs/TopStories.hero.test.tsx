import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LiveIntelItem } from '@mi/contracts';
import { TopStories } from './LiveIntelTab';

const story = (imageUrl: string | null): LiveIntelItem => ({
  id: 'li_1', source: 'news', title: 'Microsoft and Mistral expand a deal', summary: 'x', url: 'https://source.microsoft.com/a',
  publishedAt: '2026-07-01T00:00:00.000Z', sentiment: 'neutral', stale: false, publisher: 'Microsoft', imageUrl,
} as unknown as LiveIntelItem);
const company = { name: 'Mistral AI', website: 'https://mistral.ai', logoUrl: null };

describe('story hero pictures', () => {
  it('drops a picture that names another company and shows no placeholder block', () => {
    const { container } = render(<TopStories items={[story('https://cdn.microsoft.com/logo.png')]} onOpen={() => {}} company={company} />);
    expect(container.querySelector('img[src*="microsoft"]')).toBeNull();
    expect(screen.queryByTestId('company-plate')).toBeNull();
    expect(screen.getByText('Microsoft and Mistral expand a deal')).toBeInTheDocument();
  });

  it('collapses to text (no plate, no empty frame) when the story has no picture', () => {
    render(<TopStories items={[{ ...story(null), url: 'not-a-url' }]} onOpen={() => {}} company={company} />);
    expect(screen.queryByTestId('company-plate')).toBeNull();
    expect(screen.getByText('Microsoft and Mistral expand a deal')).toBeInTheDocument();
  });

  it('keeps a picture that is the subject’s own', () => {
    const { container } = render(<TopStories items={[story('https://cdn.mistral.ai/og.png')]} onOpen={() => {}} company={company} />);
    expect(container.querySelector('img[src="https://cdn.mistral.ai/og.png"]')).not.toBeNull();
    expect(screen.queryByTestId('company-plate')).toBeNull();
  });
});
