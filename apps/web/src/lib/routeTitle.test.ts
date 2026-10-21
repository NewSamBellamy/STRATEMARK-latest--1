import { describe, expect, it } from 'vitest';
import { routeTitle } from './routeTitle';

describe('routeTitle', () => {
  it('names every top-level screen, with the product last', () => {
    expect(routeTitle('/')).toBe('Stratemark');
    expect(routeTitle('/today')).toBe('Today · Stratemark');
    expect(routeTitle('/history')).toBe('All decks · Stratemark');
    expect(routeTitle('/saved')).toBe('Saved cards · Stratemark');
    expect(routeTitle('/settings')).toBe('Settings · Stratemark');
    expect(routeTitle('/settings/engine')).toBe('Settings · Stratemark');
    expect(routeTitle('/reports')).toBe('Reports · Stratemark');
    expect(routeTitle('/reports/rpt_1')).toBe('Report · Stratemark');
    expect(routeTitle('/beta')).toBe('Free beta · Stratemark');
    expect(routeTitle('/markets/mkt_a/opportunity')).toBe('Opportunity · Stratemark');
    expect(routeTitle('/markets/mkt_a/briefing')).toBe('Daily briefing · Stratemark');
    expect(routeTitle('/markets/mkt_a/settings')).toBe('Deck settings · Stratemark');
    expect(routeTitle('/nope')).toBe('Page not found · Stratemark');
  });

  it('ignores a trailing slash, and leaves a deck and a company dashboard to title themselves', () => {
    expect(routeTitle('/today/')).toBe('Today · Stratemark');
    expect(routeTitle('/markets/mkt_a/deck')).toBeNull();
    expect(routeTitle('/company/cmp_a/dashboard/overview')).toBeNull();
    expect(routeTitle('/company/cmp_a/dashboard')).toBeNull();
  });
});
