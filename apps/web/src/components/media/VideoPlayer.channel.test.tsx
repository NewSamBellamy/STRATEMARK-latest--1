import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CompanyVideo } from '@mi/contracts';
import { VideoPlayer } from './StoryMedia';

const video = (channelUrl: string): CompanyVideo => ({ id: 'dQw4w9WgXcQ', title: 'The story', age: null, views: null, channelUrl });

describe('the video player’s company-channel link', () => {
  it('is a link for a web address and plain words for anything else (a script address in a stored or imported row)', () => {
    const { unmount } = render(<VideoPlayer video={video('https://www.youtube.com/@acme')} onClose={() => undefined} />);
    expect(screen.getByText('Company channel').closest('a')).toHaveAttribute('href', 'https://www.youtube.com/@acme');
    unmount();
    for (const bad of ['javascript:alert(document.domain)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', '//evil.example/x', 'vbscript:x']) {
      const view = render(<VideoPlayer video={video(bad)} onClose={() => undefined} />);
      expect(screen.getByText('Company channel').closest('a'), bad).toBeNull();
      view.unmount();
    }
  });
});
