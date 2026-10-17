import { beforeEach, describe, expect, it } from 'vitest';
import { searchUsageThisMonth, spendSearch } from './searchKey';

describe('monthly search cap', () => {
  beforeEach(() => localStorage.removeItem('mi.searchUsage'));

  it('counts searches and refuses past the cap', () => {
    expect(spendSearch(2)).toBe(true);
    expect(spendSearch(2)).toBe(true);
    expect(spendSearch(2)).toBe(false);
    expect(searchUsageThisMonth()).toBe(2);
  });

  it('starts fresh in a new month', () => {
    localStorage.setItem('mi.searchUsage', JSON.stringify({ month: '2000-01', count: 999 }));
    expect(searchUsageThisMonth()).toBe(0);
    expect(spendSearch(1)).toBe(true);
  });
});
