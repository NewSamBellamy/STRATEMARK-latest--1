import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { lookupMajorShareholders } from '@/lib/ownership/secMajorShareholders';
import { MissionGovernanceTab } from './MissionGovernanceTab';

vi.mock('@/lib/ownership/secMajorShareholders', () => ({ lookupMajorShareholders: vi.fn() }));

const sparseTab = vi.fn().mockResolvedValue({
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

/** The company's own marketing is not governance evidence: no site crop sits under Board. */
describe('mission tab decoration', () => {
  it('shows no picture from the company site, even when its page publishes one', async () => {
    vi.mocked(lookupMajorShareholders).mockReset().mockResolvedValue(null);
    const getCompany = vi.fn().mockResolvedValue({ id: 'cmp', name: 'Mistral AI', websiteUrl: 'https://mistral.ai' });
    const { container } = renderWithProviders(<MissionGovernanceTab companyId="cmp" />, {
      repository: Object.assign(makeRepo(), { getDashboardTab: sparseTab, getCompany }),
    });
    expect(await screen.findByText('Build safe AI.')).toBeInTheDocument();
    expect(screen.queryByAltText(/image published by the company/i)).toBeNull();
    expect(screen.queryByText(/^Image:/)).toBeNull();
    expect(container.querySelector('section[aria-label*="oard" i] img, section[aria-label*="overnance" i] img')).toBeNull();
  });
});

/** The model may omit every optional section. A missing array must render as
 * an honest empty — never crash the tab (taste-test found exactly that). */
describe('mission & governance tab', () => {
  beforeEach(() => {
    sparseTab.mockClear();
    vi.mocked(lookupMajorShareholders).mockReset().mockResolvedValue(null);
  });

  it('renders with every model-authored section omitted', async () => {
    renderWithProviders(<MissionGovernanceTab companyId="cmp" />, {
      repository: Object.assign(makeRepo(), { getDashboardTab: sparseTab }),
    });
    expect(await screen.findByText('Mission')).toBeInTheDocument();
    expect(screen.getByText('Build safe AI.')).toBeInTheDocument();
    expect(screen.getByText('No board members surfaced yet.')).toBeInTheDocument();
    expect(sparseTab).toHaveBeenCalledTimes(1);
    // No SEC answer (private company, no reader) → no section at all.
    expect(screen.queryByText('Major shareholders')).not.toBeInTheDocument();
  });

  it('empty funding copy makes no promise about public-company offerings', async () => {
    renderWithProviders(<MissionGovernanceTab companyId="cmp" />, {
      repository: Object.assign(makeRepo(), { getDashboardTab: sparseTab }),
    });
    expect(await screen.findByText('No funding rounds or investors sourced')).toBeInTheDocument();
    expect(screen.queryByText(/offerings/i)).not.toBeInTheDocument();
  });

  it('a round with no amount says so and a sourced round links its source', async () => {
    const tab = vi.fn().mockResolvedValue({
      companyId: 'cmp',
      tab: 'mission_governance',
      content: {
        mission: 'Fake mission.', ethos: '', governanceStructure: '', board: [], positives: [], negatives: [], investors: [],
        fundingRounds: [
          { round: 'Series B', amountUsd: null, date: '2023 Feb', leadInvestors: [], sourceUrl: 'https://news.test/b' },
        ],
      },
      lastRefreshedAt: '2026-10-01T00:00:00.000Z',
    });
    renderWithProviders(<MissionGovernanceTab companyId="cmp" />, {
      repository: Object.assign(makeRepo(), { getDashboardTab: tab }),
    });
    expect(await screen.findByText('Amount not reported')).toBeInTheDocument();
    expect(document.querySelector('a[href="https://news.test/b"]')).not.toBeNull();
  });

  it('says "no amounts or leads" once when every round lacks them, and keeps the rounds and links', async () => {
    const tab = vi.fn().mockResolvedValue({
      companyId: 'cmp',
      tab: 'mission_governance',
      content: {
        mission: 'Fake mission.', ethos: '', governanceStructure: '', board: [], positives: [], negatives: [], investors: [],
        fundingRounds: [
          { round: 'Series A', amountUsd: null, date: '2022 Feb', leadInvestors: [], sourceUrl: 'https://news.test/a' },
          { round: 'Series B', amountUsd: null, date: '2023 Feb', leadInvestors: [], sourceUrl: 'https://news.test/b' },
        ],
      },
      lastRefreshedAt: '2026-10-01T00:00:00.000Z',
    });
    renderWithProviders(<MissionGovernanceTab companyId="cmp" />, {
      repository: Object.assign(makeRepo(), { getDashboardTab: tab }),
    });
    expect(await screen.findByText('No amounts or lead investors are recorded for these rounds.')).toBeInTheDocument();
    expect(screen.queryByText('Amount not reported')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();
    expect(screen.getByText('Series A')).toBeInTheDocument();
    expect(screen.getByText('Series B')).toBeInTheDocument();
    expect(document.querySelector('a[href="https://news.test/b"]')).not.toBeNull();
  });

  it('shows 5%+ holders from SEC filings, each citing its filing; an unstated percent is Unknown', async () => {
    vi.mocked(lookupMajorShareholders).mockResolvedValue([
      {
        holder: 'August J. Troendle', percentOfClass: 19.1, shares: 5396508, form: 'SCHEDULE 13D/A',
        filingDate: '2026-09-28', eventDate: '2026-09-24', jointFilers: ['Medpace Investors, LLC'],
        filingUrl: 'https://www.sec.gov/Archives/edgar/data/1668397/000119312526405684/xslSCHEDULE_13D_X02/primary_doc.xml',
      },
      {
        holder: 'Holder LLC', percentOfClass: null, shares: null, form: 'SCHEDULE 13G',
        filingDate: '2026-08-14', eventDate: null, jointFilers: [],
        filingUrl: 'https://www.sec.gov/Archives/edgar/data/1668397/000008025526000559/xslSCHEDULE_13G_X02/primary_doc.xml',
      },
    ]);
    const getCompany = vi.fn().mockResolvedValue({ id: 'cmp', name: 'Medpace Holdings, Inc.', websiteUrl: null });
    renderWithProviders(<MissionGovernanceTab companyId="cmp" />, {
      repository: Object.assign(makeRepo(), { getDashboardTab: sparseTab, getCompany }),
    });
    expect(await screen.findByText('Major shareholders')).toBeInTheDocument();
    expect(lookupMajorShareholders).toHaveBeenCalledWith('Medpace Holdings, Inc.');
    expect(lookupMajorShareholders).toHaveBeenCalledTimes(1);
    expect(screen.getByText('August J. Troendle')).toBeInTheDocument();
    expect(screen.getByText('19.1%')).toBeInTheDocument();
    expect(screen.getByText('With Medpace Investors, LLC')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'SEC filing' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.sec.gov/Archives/edgar/data/1668397/000119312526405684/xslSCHEDULE_13D_X02/primary_doc.xml',
      'https://www.sec.gov/Archives/edgar/data/1668397/000008025526000559/xslSCHEDULE_13G_X02/primary_doc.xml',
    ]);
  });
});
