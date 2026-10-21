import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Favicon, hostInitial } from './Favicon';
import { isCorsOpaqueSource } from '@/lib/extractColor';

describe('Favicon', () => {
  it('shows the site initial instead of a broken dot when the icon cannot load', () => {
    const { container } = render(<Favicon url="https://www.reuters.com/a" className="h-4 w-4" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('favicon-initial').textContent).toBe('R');
  });

  it('shows the icon while it loads fine', () => {
    const { container } = render(<Favicon url="https://www.reuters.com/a" />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('reuters.com');
  });

  it('has an initial for an unparseable address', () => {
    expect(hostInitial('nonsense')).toBe('?');
  });
});

describe('sources the color sampler must not request', () => {
  it.each([
    ['https://t2.gstatic.com/faviconV2?client=SOCIAL&url=https://a.com', true],
    ['https://www.google.com/s2/favicons?domain=a.com', true],
    ['https://commons.wikimedia.org/wiki/Special:FilePath/Logo.svg', true],
    ['https://upload.wikimedia.org/wikipedia/commons/a/ab/Logo.svg', false],
    ['https://a.com/apple-touch-icon.png', false],
  ])('%s -> %s', (url, expected) => {
    expect(isCorsOpaqueSource(url)).toBe(expected);
  });
});
