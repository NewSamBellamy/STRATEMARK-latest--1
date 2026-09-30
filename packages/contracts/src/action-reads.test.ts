import { describe, expect, it } from 'vitest';
import { ACTION_DEFINITIONS } from './actions';
import {
  CACHED_READ_ACTIONS,
  cachedReadResultSchema,
  cachedReadMatchesRequest,
} from './action-reads';

const at = '2026-09-30T12:00:00.000Z';
const common = {
  contractVersion: '1',
  requestId: 'req_1',
  vaultId: 'vault_1',
  revision: 4,
  observedAt: at,
  freshness: { state: 'never_researched', lastResearchedAt: null },
  evidenceRefs: [],
  gaps: [],
};
const page = { items: [], limit: 10, nextCursor: null };
const scope = {
  goal: 'Find useful tools',
  inclusions: [],
  exclusions: [],
  region: null,
  depth: 'quick',
  seeds: [],
};
const variants = [
  ['library.search', {}, page],
  ['market.list', {}, page],
  [
    'market.get',
    { marketId: 'market_1' },
    {
      marketId: 'market_1',
      name: 'Synthetic market',
      scope,
      scopeRevision: 2,
      memberships: [],
      findings: [],
      state: 'empty',
    },
  ],
  [
    'company.get',
    { companyId: 'company_1' },
    {
      companyId: 'company_1',
      identity: { name: 'Synthetic company', purpose: null, domains: [], logoAssetHash: null },
      memberships: [],
      facts: [],
      sections: [],
      state: 'sparse',
    },
  ],
  [
    'evidence.get',
    { claimId: 'claim_1' },
    { sources: [], passages: [], observations: [], state: 'missing' },
  ],
  ['scope.preview', {}, { scope, seeds: [], warnings: [] }],
  [
    'company.resolve',
    {},
    {
      candidates: [],
      unresolved: [{ name: 'Synthetic company', domain: null, reason: 'no_match' }],
    },
  ],
  [
    'comparison.get',
    { companyIds: ['company_1', 'company_2'] },
    {
      companies: [
        { companyId: 'company_1', revision: 1 },
        { companyId: 'company_2', revision: 2 },
      ],
      criteria: [],
      gaps: [],
    },
  ],
  [
    'report.get',
    { reportId: 'report_1' },
    {
      reportId: 'report_1',
      title: 'Synthetic brief',
      templateId: 'brief_1',
      templateVersion: '1',
      inputRevisions: [{ kind: 'company', companyId: 'company_1', revision: 1 }],
      sections: [],
      state: 'incomplete',
    },
  ],
  [
    'run.get',
    { runId: 'run_1' },
    {
      runId: 'run_1',
      status: 'paused',
      tasks: [],
      outputs: [],
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: null,
        priceState: 'unknown',
        inFlightMayBeBilled: false,
      },
    },
  ],
  ['run.events.list', { runId: 'run_1' }, page],
  ['updates.list', { companyId: 'company_1' }, page],
  [
    'monitor.preview',
    {},
    {
      cadence: 'daily',
      companies: [{ companyId: 'company_1', revision: 1 }],
      execution: 'desktop_session_only',
      willRunWhileClosed: false,
      maxRequestsPerTick: 2,
      warnings: [],
    },
  ],
  ['connection.audit.list', { grantId: 'grant_1' }, page],
  [
    'export.preview',
    {},
    {
      previewId: 'preview_1',
      previewHash: 'a'.repeat(64),
      format: 'json',
      recordCount: 0,
      assetCount: 0,
      estimatedBytes: 0,
      includesSecrets: false,
      warnings: [],
    },
  ],
  [
    'import.preview',
    {},
    {
      previewId: 'preview_1',
      previewHash: 'a'.repeat(64),
      schemaVersion: 1,
      recordCount: 0,
      assetCount: 0,
      state: 'valid',
      operationalAuthority: 'disabled',
      warnings: [],
    },
  ],
  [
    'provider.status',
    { connectionId: 'connection_1' },
    {
      connectionId: 'connection_1',
      configured: false,
      secretStatus: 'missing',
      capabilities: [],
      testStatus: 'untested',
    },
  ],
  [
    'budget.preview',
    {},
    {
      proposalId: 'proposal_1',
      proposalHash: 'a'.repeat(64),
      requiresApproval: true,
      priceState: 'unknown',
      estimatedCost: null,
      warnings: [],
    },
  ],
  [
    'budget.get',
    { budgetId: 'budget_1' },
    {
      budgetId: 'budget_1',
      status: 'disabled',
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: null,
        priceState: 'unknown',
        inFlightMayBeBilled: false,
      },
      remainingRequests: null,
      expiresAt: null,
    },
  ],
  [
    'vault.status',
    {},
    {
      schemaVersion: 1,
      state: 'ready',
      writerGeneration: 1,
      serviceMode: 'desktop',
      monitoringAvailable: true,
    },
  ],
] as const;

describe('cached read results', () => {
  it('covers exactly every cached-read action, not commands', () => {
    const reads = Object.entries(ACTION_DEFINITIONS)
      .filter(([, value]) => value.effect === 'read')
      .map(([name]) => name)
      .sort();
    expect(variants.map(([action]) => action).sort()).toEqual(reads);
    expect([...CACHED_READ_ACTIONS].sort()).toEqual(reads);
  });
  it.each(variants)('accepts a strict typed sparse result for %s', (action, target, data) => {
    const value = { ...common, action, target, data };
    expect(cachedReadResultSchema.parse(value)).toEqual(value);
    expect(cachedReadResultSchema.safeParse({ ...value, apiKey: 'synthetic-secret' }).success).toBe(
      false,
    );
    expect(cachedReadResultSchema.safeParse({ ...value, data: { arbitrary: true } }).success).toBe(
      false,
    );
  });
  it('rejects commands, wrong target kinds and untyped payloads', () => {
    expect(
      cachedReadResultSchema.safeParse({
        ...common,
        action: 'company.research.start',
        target: { companyId: 'company_1' },
        data: {},
      }).success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({
        ...common,
        action: 'company.get',
        target: { runId: 'run_1' },
        data: variants[3][2],
      }).success,
    ).toBe(false);
  });
  it('bounds pagination and rejects invented future freshness', () => {
    const value = { ...common, action: 'library.search', target: {}, data: page };
    expect(
      cachedReadResultSchema.safeParse({ ...value, data: { ...page, limit: 101 } }).success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({
        ...value,
        freshness: { state: 'fresh', lastResearchedAt: null },
      }).success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({
        ...value,
        freshness: { state: 'fresh', lastResearchedAt: '2027-01-01T00:00:00.000Z' },
      }).success,
    ).toBe(false);
  });
  it('requires displayed card facts to resolve to retained envelope evidence', () => {
    const ref = { sourceId: 'source_1', sourceRevision: 1, passageId: 'passage_1' };
    const value = {
      ...common,
      action: 'company.get',
      target: { companyId: 'company_1' },
      data: {
        ...variants[3][2],
        facts: [
          {
            kind: 'text',
            claimId: 'claim_1',
            label: 'Deployment',
            text: 'Local deployment is supported.',
            eventAt: null,
            evidenceRefs: [ref],
          },
        ],
      },
    };
    expect(cachedReadResultSchema.safeParse(value).success).toBe(false);
    expect(cachedReadResultSchema.safeParse({ ...value, evidenceRefs: [ref] }).success).toBe(true);
    expect(
      cachedReadResultSchema.safeParse({
        ...value,
        evidenceRefs: [ref],
        data: { ...value.data, facts: [{ ...value.data.facts[0], evidenceRefs: [] }] },
      }).success,
    ).toBe(false);
  });
  it('keeps read replies tied to the request and requested fixed revision', () => {
    const request = {
      contractVersion: '1',
      requestId: 'req_1',
      vaultId: 'vault_1',
      action: 'company.get',
      target: { companyId: 'company_1' },
      input: { revision: 4 },
    };
    const result = {
      ...common,
      action: 'company.get',
      target: request.target,
      data: variants[3][2],
    };
    expect(cachedReadMatchesRequest(request, result)).toBe(true);
    expect(cachedReadMatchesRequest(request, { ...result, vaultId: 'vault_other' })).toBe(false);
    expect(cachedReadMatchesRequest(request, { ...result, requestId: 'req_other' })).toBe(false);
    expect(cachedReadMatchesRequest(request, { ...result, revision: 5 })).toBe(false);
    expect(
      cachedReadMatchesRequest(request, { ...result, target: { companyId: 'company_other' } }),
    ).toBe(false);
    expect(
      cachedReadMatchesRequest(request, {
        ...result,
        data: { ...result.data, companyId: 'company_other' },
      }),
    ).toBe(false);
  });
  it('never converts unknown prices to free or promises closed-app monitoring', () => {
    const run = { ...common, action: 'run.get', target: variants[9][1], data: variants[9][2] };
    expect(
      cachedReadResultSchema.safeParse({
        ...run,
        data: {
          ...run.data,
          usage: { ...run.data.usage, cost: { currency: 'USD', amountMinor: 0, kind: 'known' } },
        },
      }).success,
    ).toBe(false);
    const monitor = { ...common, action: 'monitor.preview', target: {}, data: variants[12][2] };
    expect(
      cachedReadResultSchema.safeParse({
        ...monitor,
        data: { ...monitor.data, willRunWhileClosed: true },
      }).success,
    ).toBe(false);
  });
  it('rejects misbound nested records, duplicate cards and report success without support', () => {
    const company = {
      ...common,
      action: 'company.get',
      target: { companyId: 'company_1' },
      data: variants[3][2],
    };
    const membership = {
      companyId: 'company_other',
      marketId: 'market_1',
      revision: 1,
      roles: ['company'],
      relevance: { reason: 'Synthetic fit', basis: 'unresolved', evidenceRefs: [] },
    };
    expect(
      cachedReadResultSchema.safeParse({
        ...company,
        data: { ...company.data, memberships: [membership] },
      }).success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({ ...company, data: { ...company.data, state: 'ready' } })
        .success,
    ).toBe(false);
    const report = {
      ...common,
      action: 'report.get',
      target: variants[8][1],
      data: { ...variants[8][2], state: 'complete' },
    };
    expect(cachedReadResultSchema.safeParse(report).success).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({
        ...report,
        data: {
          ...report.data,
          sections: [{ heading: 'Summary', text: 'Synthetic unsupported text', evidenceRefs: [] }],
        },
      }).success,
    ).toBe(false);
    const ref = { sourceId: 'source_1', sourceRevision: 1, passageId: 'passage_1' };
    const fact = {
      kind: 'text',
      claimId: 'claim_1',
      label: 'Deployment',
      text: 'Local deployment is supported.',
      eventAt: null,
      evidenceRefs: [ref],
    };
    expect(
      cachedReadResultSchema.safeParse({
        ...company,
        evidenceRefs: [ref],
        data: { ...company.data, facts: [fact, fact] },
      }).success,
    ).toBe(false);
  });
  it('does not mix event streams or comparison companies from other requests', () => {
    const events = {
      ...common,
      action: 'run.events.list',
      target: { runId: 'run_1' },
      data: {
        ...page,
        items: [
          {
            id: 'event_1',
            runId: 'run_other',
            sequence: 1,
            occurredAt: at,
            kind: 'paused',
            taskId: null,
            recordRefs: [],
          },
        ],
      },
    };
    expect(cachedReadResultSchema.safeParse(events).success).toBe(false);
    const compare = {
      ...common,
      action: 'comparison.get',
      target: variants[7][1],
      data: {
        ...variants[7][2],
        companies: [
          { companyId: 'company_1', revision: 1 },
          { companyId: 'company_other', revision: 2 },
        ],
      },
    };
    expect(cachedReadResultSchema.safeParse(compare).success).toBe(false);
  });
  it('preserves numeric card values, units and periods instead of detached display strings', () => {
    const ref = { sourceId: 'source_1', sourceRevision: 1, passageId: 'passage_1' };
    const observation = {
      contractVersion: '1',
      vaultId: 'vault_1',
      id: 'observation_1',
      revision: 1,
      createdAt: at,
      updatedAt: at,
      companyId: 'company_1',
      metricDefinitionId: 'employees',
      scope: { kind: 'company', id: 'company_1' },
      unit: 'employees',
      currency: null,
      period: { kind: 'instant', at: '2025-12-31T00:00:00Z' },
      value: 0,
      support: 'supported',
      evidenceRefs: [ref],
    };
    const result = {
      ...common,
      evidenceRefs: [ref],
      action: 'company.get',
      target: { companyId: 'company_1' },
      data: { ...variants[3][2], facts: [{ kind: 'numeric', label: 'Employees', observation }] },
    };
    expect(cachedReadResultSchema.parse(result)).toEqual(result);
    expect(
      cachedReadResultSchema.safeParse({
        ...result,
        data: {
          ...result.data,
          facts: [
            {
              kind: 'numeric',
              label: 'Employees',
              observation: { ...observation, period: undefined },
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({
        ...result,
        data: {
          ...result.data,
          facts: [
            {
              kind: 'numeric',
              label: 'Employees',
              observation: { ...observation, companyId: 'company_other' },
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({
        ...result,
        data: {
          ...result.data,
          facts: [
            {
              kind: 'numeric',
              label: 'Employees',
              observation: { ...observation, vaultId: 'vault_other' },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it('round-trips retained evidence and rejects missing source versions or foreign vault records', () => {
    const version = {
      contractVersion: '1',
      vaultId: 'vault_1',
      revision: 1,
      createdAt: at,
      updatedAt: at,
    };
    const source = {
      ...version,
      id: 'source_1',
      canonicalUrl: 'https://example.com/report',
      originalUrl: 'https://example.com/report',
      contentHash: 'a'.repeat(64),
      fetchedAt: at,
      publishedAt: null,
      eventAt: null,
      retrievalStatus: 'retrieved',
      origin: 'web',
      visibilityScope: { companyIds: ['company_1'], marketIds: [] },
    };
    const passage = {
      ...version,
      id: 'passage_1',
      sourceId: 'source_1',
      sourceRevision: 1,
      text: 'The company reported zero employees for the stated period.',
      contentHash: 'b'.repeat(64),
      origin: 'web',
      visibilityScope: source.visibilityScope,
    };
    const ref = { sourceId: 'source_1', sourceRevision: 1, passageId: 'passage_1' };
    const observation = {
      ...version,
      id: 'observation_1',
      companyId: 'company_1',
      metricDefinitionId: 'employees',
      scope: { kind: 'company', id: 'company_1' },
      unit: 'employees',
      currency: null,
      period: { kind: 'instant', at },
      value: 0,
      support: 'supported',
      evidenceRefs: [ref],
    };
    const result = {
      ...common,
      action: 'evidence.get',
      target: { sourceId: 'source_1' },
      evidenceRefs: [ref],
      data: {
        sources: [source],
        passages: [passage],
        observations: [observation],
        state: 'available',
      },
    };
    expect(cachedReadResultSchema.parse(result)).toEqual(result);
    expect(
      cachedReadResultSchema.safeParse({ ...result, data: { ...result.data, sources: [] } })
        .success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({ ...result, data: { ...result.data, passages: [] } })
        .success,
    ).toBe(false);
    expect(
      cachedReadResultSchema.safeParse({
        ...result,
        data: { ...result.data, observations: [{ ...observation, vaultId: 'vault_other' }] },
      }).success,
    ).toBe(false);
  });
});
