import { describe, expect, it } from 'vitest';
import { vaultCompanySchema, vaultMarketSchema, vaultMembershipSchema } from './vault-inventory';
const at = '2026-09-30T12:00:00.000Z';
const record = {
  contractVersion: '1',
  vaultId: 'vault_a',
  id: 'co_a',
  revision: 1,
  createdAt: at,
  updatedAt: at,
};
const company = { record, name: 'Fixture Labs', officialDomain: null };
describe('retained inventory shapes, not approvals', () => {
  it('preserves the original minimal inventory shape without invented metadata', () => {
    expect(vaultCompanySchema.parse(company)).toEqual(company);
    const market = { record: { ...record, id: 'mkt_a' }, name: 'Market' };
    expect(vaultMarketSchema.parse(market)).toEqual(market);
  });
  it('retains exact reported profile text and accepts bounded HTTP(S) references', () => {
    const rich = {
      ...company,
      profile: {
        oneLiner: '  Original prose\n',
        hqLocation: null,
        websiteUrl: 'https://a.example/path',
        logoUrl: null,
        brandTheme: null,
      },
      identityHints: { aliases: ['Prior Labs'], domains: ['prior.example'] },
    };
    expect(vaultCompanySchema.parse(rich)).toEqual(rich);
  });
  it.each([
    'javascript:alert(1)',
    'file:///private',
    'https://user:secret@a.example',
    'data:image/png;base64,a',
  ])('rejects unsafe remote metadata reference %s', (url) => {
    expect(
      vaultCompanySchema.safeParse({
        ...company,
        profile: {
          oneLiner: '',
          hqLocation: null,
          websiteUrl: url,
          logoUrl: null,
          brandTheme: null,
        },
      }).success,
    ).toBe(false);
  });
  it('does not accept fabricated identity proof or scope approval flags', () => {
    expect(
      vaultCompanySchema.safeParse({
        ...company,
        identityHints: { aliases: [], domains: [], verified: true },
      }).success,
    ).toBe(false);
    expect(
      vaultMarketSchema.safeParse({ record, name: 'Market', scopeConfirmed: true }).success,
    ).toBe(false);
  });
  it('bounds identity hints and preserves name ambiguity', () => {
    expect(
      vaultCompanySchema.safeParse({
        ...company,
        identityHints: { aliases: ['Same', 'same'], domains: [] },
      }).success,
    ).toBe(false);
    expect(
      vaultCompanySchema.safeParse({
        ...company,
        identityHints: { aliases: Array.from({ length: 51 }, (_, i) => `Alias ${i}`), domains: [] },
      }).success,
    ).toBe(false);
    expect(
      vaultCompanySchema.safeParse({
        ...company,
        identityHints: { aliases: ['Same Name'], domains: ['a.example', 'b.example'] },
      }).success,
    ).toBe(true);
  });
  it('validates IDs rather than permitting arbitrary membership targets', () => {
    expect(
      vaultMembershipSchema.safeParse({
        record,
        companyId: '../outside',
        marketId: 'mkt_a',
        roles: ['company'],
      }).success,
    ).toBe(false);
  });
  it('uses the existing scope contract without creating schedules or budgets', () => {
    const scopeDraft = {
      goal: 'Industrial robotics',
      inclusions: [],
      exclusions: ['Consultants'],
      region: null,
      depth: 'standard',
      seeds: [
        { name: 'Same Name', domain: 'a.example' },
        { name: 'Same Name', domain: 'b.example' },
      ],
    };
    const market = {
      record,
      name: 'Robotics',
      scopeDraft,
      legacyScope: { vertical: 'Robots', geography: null, notes: null },
    };
    expect(vaultMarketSchema.parse(market)).toEqual(market);
    expect(
      vaultMarketSchema.safeParse({
        ...market,
        scopeDraft: { ...scopeDraft, budgetApproved: true },
      }).success,
    ).toBe(false);
  });
});
