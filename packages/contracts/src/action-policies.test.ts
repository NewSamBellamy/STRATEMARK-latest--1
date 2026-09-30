import { describe, expect, it } from 'vitest';
import { ACTION_DEFINITIONS } from './actions';
import {
  approvalChallengeSchema,
  budgetPolicySchema,
  connectionGrantSchema,
  egressPolicySchema,
} from './action-policies';

const issuedAt = '2026-09-30T10:00:00.000Z';
const expiresAt = '2026-10-30T10:00:00.000Z';
const target = { kind: 'company', companyId: 'co_1', revision: 7 };

const approvalChallenge = {
  contractVersion: '1',
  id: 'challenge_1',
  action: 'connection.grant',
  payloadSHA256: 'a'.repeat(64),
  authenticatedActorRef: 'actor_1',
  vaultId: 'vault_1',
  vaultRevision: 12,
  targets: [target],
  issuedAt,
  expiresAt: '2026-09-30T10:05:00.000Z',
  consumedAt: null,
};

const connectionGrant = {
  contractVersion: '1',
  id: 'grant_1',
  revision: 1,
  vaultId: 'vault_1',
  clientBindingRef: 'client_1',
  actions: ['company.get', 'evidence.get'],
  fields: ['identity', 'observations', 'evidence'],
  records: [target],
  maxResponseBytes: 65_536,
  issuedAt,
  expiresAt,
  revokedAt: null,
};

const egressPolicy = {
  contractVersion: '1',
  id: 'egress_1',
  revision: 2,
  vaultId: 'vault_1',
  connectionIds: ['connection_1'],
  modelCapabilities: ['model', 'extraction'],
  retrievalCapabilities: ['web_search', 'page_retrieval'],
  scope: { kind: 'records', records: [target] },
  purposes: ['company_research', 'answer'],
  budgetRef: 'budget_1',
  issuedAt,
  expiresAt,
};

const budgetPolicy = {
  contractVersion: '1',
  id: 'budget_1',
  revision: 3,
  vaultId: 'vault_1',
  maxRequests: 100,
  maxInputTokens: 20_000,
  maxOutputTokens: 4_000,
  durationDays: 30,
  connectionIds: ['connection_1'],
  scope: { kind: 'records', records: [target] },
  currencyLimit: { currency: 'USD', amountMinor: 10_000 },
  priceHandling: 'reject_unknown',
  issuedAt,
  expiresAt,
  state: 'active',
};

describe('persisted action policies', () => {
  it('accepts typed version 1 records with pinned revisions and bounded scopes', () => {
    expect(approvalChallengeSchema.parse(approvalChallenge)).toEqual(approvalChallenge);
    expect(connectionGrantSchema.parse(connectionGrant)).toEqual(connectionGrant);
    expect(egressPolicySchema.parse(egressPolicy)).toEqual(egressPolicy);
    expect(budgetPolicySchema.parse(budgetPolicy)).toEqual(budgetPolicy);
    expect(
      approvalChallengeSchema.safeParse({ ...approvalChallenge, contractVersion: '2' }).success,
    ).toBe(false);
    expect(
      connectionGrantSchema.safeParse({ ...connectionGrant, contractVersion: '2' }).success,
    ).toBe(false);
    expect(egressPolicySchema.safeParse({ ...egressPolicy, contractVersion: '2' }).success).toBe(
      false,
    );
    expect(budgetPolicySchema.safeParse({ ...budgetPolicy, contractVersion: '2' }).success).toBe(
      false,
    );
  });

  it('treats challenge parsing as shape validation and bounds one-use timestamps', () => {
    expect(
      approvalChallengeSchema.safeParse({
        ...approvalChallenge,
        consumedAt: '2026-09-30T10:05:00.000Z',
      }).success,
    ).toBe(true);
    for (const consumedAt of ['2026-09-30T09:59:59.999Z', '2026-09-30T10:05:00.001Z']) {
      expect(approvalChallengeSchema.safeParse({ ...approvalChallenge, consumedAt }).success).toBe(
        false,
      );
    }
    expect(
      approvalChallengeSchema.safeParse({
        ...approvalChallenge,
        expiresAt: issuedAt,
      }).success,
    ).toBe(false);
    expect(
      approvalChallengeSchema.safeParse({ ...approvalChallenge, action: 'fetch_url' }).success,
    ).toBe(false);
  });

  it('pins vault-only approvals without inventing a saved-record target', () => {
    for (const action of ['provider.configure', 'budget.approve']) {
      const challenge = { ...approvalChallenge, action, targets: [] };
      expect(approvalChallengeSchema.parse(challenge)).toEqual(challenge);
    }
    expect(
      approvalChallengeSchema.safeParse({ ...approvalChallenge, vaultRevision: -1 }).success,
    ).toBe(false);
    expect(
      approvalChallengeSchema.safeParse({
        ...approvalChallenge,
        targets: Array.from({ length: 21 }, (_, index) => ({
          kind: 'company',
          companyId: `co_${index}`,
          revision: 1,
        })),
      }).success,
    ).toBe(false);
  });

  it('rejects forged authority claims and all unmodeled fields', () => {
    for (const extra of [
      { actorRole: 'owner' },
      { owner: true },
      { user_verified: true },
      { apiKey: 'synthetic-secret' },
      { payload: { arbitrary: true } },
    ]) {
      expect(approvalChallengeSchema.safeParse({ ...approvalChallenge, ...extra }).success).toBe(
        false,
      );
    }
    expect(
      approvalChallengeSchema.safeParse({
        ...approvalChallenge,
        payloadSHA256: 'not-a-sha256',
      }).success,
    ).toBe(false);
  });

  it('derives grant actions from the catalogue and excludes never or human-only actions', () => {
    const catalog = Object.entries(ACTION_DEFINITIONS);
    const allowed = catalog.filter(
      ([, definition]) => definition.external !== 'never' && !definition.humanOnly,
    );
    const forbidden = catalog.filter(
      ([, definition]) => definition.external === 'never' || definition.humanOnly,
    );
    for (const [action, definition] of allowed) {
      const paidJob = definition.effect === 'job' && definition.billable;
      expect(
        connectionGrantSchema.safeParse({
          ...connectionGrant,
          actions: [action],
          ...(paidJob ? { policyRef: 'policy_1', budgetRef: 'budget_1' } : {}),
        }).success,
      ).toBe(true);
    }
    for (const [action] of forbidden) {
      expect(
        connectionGrantSchema.safeParse({ ...connectionGrant, actions: [action] }).success,
      ).toBe(false);
    }
    expect(connectionGrantSchema.safeParse({ ...connectionGrant, actions: ['*'] }).success).toBe(
      false,
    );
  });

  it('requires paired policy and budget references only for paid jobs', () => {
    const paidGrant = {
      ...connectionGrant,
      actions: ['company.research.start'],
      policyRef: 'policy_1',
      budgetRef: 'budget_1',
    };
    expect(connectionGrantSchema.safeParse(paidGrant).success).toBe(true);
    expect(connectionGrantSchema.safeParse({ ...paidGrant, policyRef: undefined }).success).toBe(
      false,
    );
    expect(
      connectionGrantSchema.safeParse({ ...connectionGrant, policyRef: 'policy_1' }).success,
    ).toBe(false);
    expect(
      connectionGrantSchema.safeParse({ ...connectionGrant, budgetRef: 'budget_1' }).success,
    ).toBe(false);
  });

  it('bounds grant expiry, selected records, response bytes, and finite fields', () => {
    expect(
      connectionGrantSchema.safeParse({
        ...connectionGrant,
        expiresAt: '2026-10-30T10:00:00.001Z',
      }).success,
    ).toBe(false);
    expect(
      connectionGrantSchema.safeParse({ ...connectionGrant, maxResponseBytes: 1_000_001 }).success,
    ).toBe(false);
    expect(
      connectionGrantSchema.safeParse({
        ...connectionGrant,
        revokedAt: '2026-10-31T10:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      connectionGrantSchema.safeParse({
        ...connectionGrant,
        revokedAt: '2026-09-30T09:59:59.999Z',
      }).success,
    ).toBe(false);
    expect(
      connectionGrantSchema.safeParse({ ...connectionGrant, fields: ['identity', '*'] }).success,
    ).toBe(false);
    expect(connectionGrantSchema.safeParse({ ...connectionGrant, records: [] }).success).toBe(
      false,
    );
    expect(
      connectionGrantSchema.safeParse({
        ...connectionGrant,
        records: Array.from({ length: 21 }, (_, index) => ({
          kind: 'company',
          companyId: `co_${index}`,
          revision: 1,
        })),
      }).success,
    ).toBe(false);
    expect(
      connectionGrantSchema.safeParse({ ...connectionGrant, extraEndpoint: 'https://example.com' })
        .success,
    ).toBe(false);
  });

  it('keeps egress connections, capabilities, purposes, records, and expiry explicit', () => {
    expect(
      egressPolicySchema.safeParse({ ...egressPolicy, retrievalCapabilities: ['*'] }).success,
    ).toBe(false);
    expect(egressPolicySchema.safeParse({ ...egressPolicy, purposes: ['anything'] }).success).toBe(
      false,
    );
    expect(
      egressPolicySchema.safeParse({ ...egressPolicy, connectionIds: ['connection_1', '*'] })
        .success,
    ).toBe(false);
    expect(egressPolicySchema.safeParse({ ...egressPolicy, expiresAt: issuedAt }).success).toBe(
      false,
    );
    for (const unsafeField of [
      { endpoint: 'https://provider.example/v1' },
      { apiKey: 'synthetic-secret' },
      { path: 'C:\\vault\\vault.sqlite' },
      { fetch: true },
    ]) {
      expect(egressPolicySchema.safeParse({ ...egressPolicy, ...unsafeField }).success).toBe(false);
    }
  });

  it('allows model-only or retrieval-only policies, but never an empty capability set', () => {
    expect(
      egressPolicySchema.safeParse({ ...egressPolicy, retrievalCapabilities: [] }).success,
    ).toBe(true);
    expect(egressPolicySchema.safeParse({ ...egressPolicy, modelCapabilities: [] }).success).toBe(
      true,
    );
    expect(
      egressPolicySchema.safeParse({
        ...egressPolicy,
        modelCapabilities: [],
        retrievalCapabilities: [],
      }).success,
    ).toBe(false);
  });

  it('binds input-only egress scopes to explicit scope-assist or provider-test requests', () => {
    const { scope: _scope, ...basePolicy } = egressPolicy;
    for (const [action, purpose] of [
      ['scope.assist.start', 'scope_assistance'],
      ['provider.test.start', 'provider_test'],
    ]) {
      const policy = {
        ...basePolicy,
        scope: {
          kind: 'input_only',
          action,
          requestId: 'req_1',
          payloadHash: 'b'.repeat(64),
        },
        purposes: [purpose],
      };
      expect(egressPolicySchema.parse(policy)).toEqual(policy);
    }
    expect(
      egressPolicySchema.safeParse({
        ...basePolicy,
        scope: {
          kind: 'input_only',
          action: '*',
          requestId: 'req_1',
          payloadHash: 'b'.repeat(64),
        },
        purposes: ['scope_assistance'],
      }).success,
    ).toBe(false);
    expect(
      egressPolicySchema.safeParse({
        ...basePolicy,
        scope: {
          kind: 'input_only',
          action: 'scope.assist.start',
          requestId: 'req_1',
          payloadHash: 'b'.repeat(64),
        },
        purposes: ['provider_test'],
      }).success,
    ).toBe(false);
  });

  it('requires finite budget ceilings and rejects unknown-price routes', () => {
    for (const limits of [
      { maxRequests: Infinity },
      { maxInputTokens: 10_000_001 },
      { maxOutputTokens: 2_000_001 },
      { durationDays: 366 },
    ]) {
      expect(budgetPolicySchema.safeParse({ ...budgetPolicy, ...limits }).success).toBe(false);
    }
    expect(
      budgetPolicySchema.safeParse({ ...budgetPolicy, priceHandling: 'allow_unpriced' }).success,
    ).toBe(false);
    const { currencyLimit: _currencyLimit, ...withoutCurrencyLimit } = budgetPolicy;
    expect(
      budgetPolicySchema.safeParse({ ...withoutCurrencyLimit, priceHandling: 'allow_unpriced' })
        .success,
    ).toBe(true);
    expect(
      budgetPolicySchema.safeParse({
        ...budgetPolicy,
        currencyLimit: { currency: 'USD', amountMinor: Infinity },
      }).success,
    ).toBe(false);
    expect(
      budgetPolicySchema.safeParse({ ...budgetPolicy, apiKey: 'synthetic-secret' }).success,
    ).toBe(false);
  });

  it('bounds budget expiry by its finite duration from issuance', () => {
    expect(budgetPolicySchema.safeParse({ ...budgetPolicy, expiresAt: issuedAt }).success).toBe(
      false,
    );
    expect(
      budgetPolicySchema.safeParse({
        ...budgetPolicy,
        expiresAt: '2026-10-30T10:00:00.001Z',
      }).success,
    ).toBe(false);
  });

  it('keeps restored budget references stopped pending reconciliation', () => {
    expect(
      budgetPolicySchema.safeParse({
        ...budgetPolicy,
        state: 'reconciliation_required',
        restoredFromRef: 'budget_previous',
      }).success,
    ).toBe(true);
    expect(
      budgetPolicySchema.safeParse({
        ...budgetPolicy,
        state: 'active',
        restoredFromRef: 'budget_previous',
      }).success,
    ).toBe(false);
    expect(budgetPolicySchema.safeParse({ ...budgetPolicy, state: 'running' }).success).toBe(false);
  });

  it('supports only selected-record or request-bound input-only budget scopes', () => {
    const { scope: _scope, ...basePolicy } = budgetPolicy;
    for (const action of ['scope.assist.start', 'provider.test.start']) {
      const scope = {
        kind: 'input_only',
        action,
        requestId: 'req_1',
        payloadHash: 'c'.repeat(64),
      };
      expect(budgetPolicySchema.parse({ ...basePolicy, scope })).toEqual({ ...basePolicy, scope });
    }
    expect(
      budgetPolicySchema.safeParse({
        ...basePolicy,
        scope: {
          kind: 'input_only',
          action: 'provider.test.start',
          requestId: 'req_1',
          payloadHash: '*',
        },
      }).success,
    ).toBe(false);
    expect(budgetPolicySchema.safeParse({ ...basePolicy, scope: { kind: 'vault' } }).success).toBe(
      false,
    );
  });
});
