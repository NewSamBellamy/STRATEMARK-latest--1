import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HistoryVideo } from '@mi/contracts';
import { HistoryVideoHero } from './HistoryVideoHero';

const video: HistoryVideo = {
  id: 'abcDEF12345',
  title: 'The story of Acme',
  channel: 'Acme',
  channelUrl: 'https://www.youtube.com/@acme',
  verdict: 'Names the company and covers its founding.',
  checkedAt: '2026-10-17T00:00:00.000Z',
};

describe('HistoryVideoHero', () => {
  it('shows a thumbnail and the reason it was chosen, and loads nothing from YouTube until play', async () => {
    const { container } = render(<HistoryVideoHero video={video} companyName="Acme" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText(/Names the company and covers its founding/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcDEF12345');
    await userEvent.click(screen.getByRole('button', { name: /Play video: The story of Acme/ }));
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('youtube-nocookie.com/embed/abcDEF12345');
  });

  it('does not link a channel it has no url for', () => {
    render(<HistoryVideoHero video={{ ...video, channelUrl: null }} companyName="Acme" />);
    expect(screen.queryByRole('link', { name: 'Acme' })).not.toBeInTheDocument();
    expect(screen.getByText(/^Acme\s·/)).toBeInTheDocument();
  });
});
