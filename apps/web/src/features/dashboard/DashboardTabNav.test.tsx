import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { DashboardTab } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { DashboardTabNav } from './DashboardPage';

const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });

/** A fake viewport: the tab bar only asks whether it is at least 1344 px wide. */
function viewport(width: number) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width: 1344px') ? width >= 1344 : query.includes('max-width: 1023px') ? width <= 1023 : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function show(activeTab: DashboardTab) {
  return renderWithProviders(
    <DashboardTabNav companyId="cmp_1" activeTab={activeTab} fromMarketId={null} fromCardId={null} fromDeckView={null} />,
    { repository: makeRepo() },
  );
}

describe('dashboard tab nav', () => {
  it('names the active tab on the More button when it sits inside the overflow', () => {
    viewport(1024);
    show('live_intel');
    expect(screen.getByRole('button', { name: /More · Live Intel/ })).toBeInTheDocument();
  });

  it('keeps the plain More label while the active tab is visible', () => {
    viewport(1024);
    show('overview');
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('on a phone lays every tab in one scrolling bar, with the active tab marked, instead of a clipped dropdown', () => {
    viewport(390);
    show('live_intel');
    expect(screen.queryByRole('button', { name: /More/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('navigation', { name: 'Company dashboard tabs' }).className).toContain('max-lg:overflow-x-auto');
  });

  it('shows every tab and no More button at 1344 px and wider', () => {
    viewport(1400);
    show('live_intel');
    expect(screen.queryByRole('button', { name: /More/ })).not.toBeInTheDocument();
    for (const name of ['Overview', 'Metrics', 'Live Intel']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('link')).toHaveLength(9);
  });
});
