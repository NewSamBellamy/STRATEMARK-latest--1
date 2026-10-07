import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { MissionGovernanceTab } from './MissionGovernanceTab';

/** The model may omit every optional section. A missing array must render as
 * an honest empty — never crash the tab (taste-test found exactly that). */
describe('mission & governance tab', () => {
  it('renders with every model-authored section omitted', async () => {
    const getDashboardTab = vi.fn().mockResolvedValue({
      companyId: 'cmp',
      tab: 'mission_governance',
      content: {
        mission: 'Build safe AI.',
        ethos: null,
        governanceStructure: null,
        board: undefined,
        fundingRounds: undefined,
        investors: undefined,
        positives: undefined,
      },
      lastRefreshedAt: '2026-10-01T00:00:00.000Z',
    });
    renderWithProviders(<MissionGovernanceTab companyId="cmp" />, {
      repository: Object.assign(makeRepo(), { getDashboardTab }),
    });
    expect(await screen.findByText('Mission')).toBeInTheDocument();
    expect(screen.getByText('Build safe AI.')).toBeInTheDocument();
    expect(screen.getByText('No board members surfaced yet.')).toBeInTheDocument();
    expect(getDashboardTab).toHaveBeenCalledTimes(1);
  });
});
