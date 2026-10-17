import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { SourceActivity } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { groupSites, useSourceActivity } from './sourceActivity';

const a = (id: number, domain: string, kind: SourceActivity['kind'], at: string, company: string | null = null): SourceActivity => ({ id, at, domain, kind, company });

describe('groupSites', () => {
  it('groups by site, newest first, with how many times each was touched and the latest action', () => {
    const rows = groupSites([
      a(1, 'sec.gov', 'searched', '2026-10-17T10:00:00Z', 'Acme'),
      a(2, 'reuters.com', 'read', '2026-10-17T10:00:05Z'),
      a(3, 'sec.gov', 'read', '2026-10-17T10:00:09Z', 'Acme'),
    ]);
    expect(rows.map((r) => r.domain)).toEqual(['sec.gov', 'reuters.com']);
    expect(rows[0]).toMatchObject({ count: 2, kind: 'read', company: 'Acme' });
  });

  it('keeps only the newest sites when there are many', () => {
    const many = Array.from({ length: 30 }, (_, i) => a(i + 1, `site${i}.example`, 'found', `2026-10-17T10:00:${String(i).padStart(2, '0')}Z`));
    const rows = groupSites(many, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.domain).toBe('site29.example');
  });
});

function Probe({ active }: { active: boolean }) {
  const { items, supported } = useSourceActivity(active);
  return <p data-testid="out">{supported ? items.map((i) => i.domain).join(',') : 'unsupported'}</p>;
}

describe('useSourceActivity', () => {
  it('asks only while active, passes the last id along and appends what is new', async () => {
    const listSourceActivity = vi.fn()
      .mockResolvedValueOnce({ items: [a(1, 'sec.gov', 'searched', '2026-10-17T10:00:00Z')], lastId: 1 })
      .mockResolvedValue({ items: [], lastId: 1 });
    const repo = Object.assign(makeRepo(), { listSourceActivity });
    function Harness() {
      const [on, setOn] = useState(false);
      return <><button type="button" onClick={() => setOn(true)}>start</button><Probe active={on} /></>;
    }
    const { user } = renderWithProviders(<Harness />, { repository: repo });
    expect(listSourceActivity).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('sec.gov'));
    expect(listSourceActivity).toHaveBeenCalledWith(0);
  });

  it('reports an engine without the feed as unsupported', () => {
    renderWithProviders(<Probe active />, { repository: makeRepo() });
    expect(screen.getByTestId('out')).toHaveTextContent('unsupported');
  });
});
