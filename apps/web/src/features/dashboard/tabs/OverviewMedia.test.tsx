import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CompanyVideo, LiveIntelItem } from '@mi/contracts';
import { StoryThumb, VideoScroller } from './OverviewTab';

const item = (over: Partial<LiveIntelItem>): LiveIntelItem => ({
  id: '1', source: 'news', title: 'A story', url: 'https://www.reuters.com/a', summary: '', detail: null, publishedDate: null,
  sentiment: 'neutral', publishedAt: '2026-10-01T00:00:00.000Z', stale: false, publisher: 'Reuters', imageUrl: null, ...over,
});

describe('overview story thumbnails', () => {
  it('shows the picture research stored with the story', () => {
    const { container } = render(<StoryThumb item={item({ imageUrl: 'https://cdn.reuters.com/pic.jpg' })} />);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it("shows the publisher's initial, and fetches nothing, when no picture is stored", () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(<StoryThumb item={item({ imageUrl: null })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('R');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('overview video scroller', () => {
  const videos: CompanyVideo[] = Array.from({ length: 6 }, (_, i) => ({
    id: `abcdefghij${i}`, title: `Video ${i}`, age: null, views: null, channelUrl: 'https://www.youtube.com/@acme',
  }));

  it('lists every stored video in one row', () => {
    render(<VideoScroller videos={videos} />);
    expect(screen.getAllByRole('button', { name: /Play video/ })).toHaveLength(6);
  });

  it('shows no arrows when nothing overflows', () => {
    // jsdom lays nothing out, so the row never overflows.
    render(<VideoScroller videos={videos.slice(0, 2)} />);
    expect(screen.queryByRole('button', { name: 'More videos' })).toBeNull();
  });
});
