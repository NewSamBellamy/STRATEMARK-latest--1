import { describe, expect, it } from 'vitest';
import { actionReceiptSchema, runOutputManifestSchema } from './action-results';

const receipt = {
  contractVersion: '1',
  actionId: 'act_1',
  requestId: 'req_1',
  vaultId: 'v_1',
  acceptedAt: '2026-09-30T12:00:00.000Z',
  resultingRevision: 2,
  action: 'company.research.start',
  target: { companyId: 'co_1' },
  effect: 'job',
  status: 'queued',
  runId: 'run_1',
};
const pinnedCompany = { kind: 'company', companyId: 'co_1', revision: 2 };
const output = {
  contractVersion: '1',
  vaultId: 'v_1',
  runId: 'run_1',
  outputId: 'out_1',
  revision: 1,
  observedAt: '2026-09-30T12:00:00.000Z',
  status: 'completed',
  originatingScope: [pinnedCompany],
  inputRevisions: [pinnedCompany],
  evidenceRefs: [{ sourceId: 'src_1', sourceRevision: 3, passageId: 'passage_1' }],
  gaps: [],
  result: {
    kind: 'answer',
    answerId: 'answer_1',
    text: 'Fixture answer',
    citations: [{ sourceId: 'src_1', sourceRevision: 3, passageId: 'passage_1' }],
  },
};

describe('persisted action results', () => {
  it('requires a stable run on every accepted asynchronous command', () => {
    expect(actionReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(actionReceiptSchema.safeParse({ ...receipt, runId: undefined }).success).toBe(false);
    expect(actionReceiptSchema.safeParse({ ...receipt, target: { marketId: 'm_1' } }).success).toBe(
      false,
    );
  });
  it('distinguishes nonbillable local jobs, writes and navigation from queries', () => {
    expect(
      actionReceiptSchema.safeParse({ ...receipt, action: 'backup.create', target: {} }).success,
    ).toBe(true);
    expect(actionReceiptSchema.safeParse({ ...receipt, action: 'company.get' }).success).toBe(
      false,
    );
    const write = {
      ...receipt,
      action: 'saved.update',
      target: { kind: 'company', companyId: 'co_1' },
      effect: 'write',
      status: 'applied',
      runId: undefined,
    };
    expect(actionReceiptSchema.safeParse(write).success).toBe(true);
    expect(actionReceiptSchema.safeParse({ ...write, runId: 'run_1' }).success).toBe(false);
    const { runId, ...navigation } = write;
    expect(runId).toBeUndefined();
    expect(
      actionReceiptSchema.safeParse({
        ...navigation,
        action: 'navigation.open',
        target: { kind: 'vault' },
        effect: 'local',
        status: 'opened',
      }).success,
    ).toBe(true);
  });
  it('binds resume and lifecycle acknowledgements to the existing run', () => {
    expect(
      actionReceiptSchema.safeParse({
        ...receipt,
        action: 'run.resume',
        target: { runId: 'run_2' },
      }).success,
    ).toBe(false);
    const pause = {
      ...receipt,
      action: 'run.pause',
      target: { runId: 'run_1' },
      effect: 'write',
      status: 'pausing',
    };
    expect(actionReceiptSchema.safeParse(pause).success).toBe(true);
    expect(actionReceiptSchema.safeParse({ ...pause, status: 'applied' }).success).toBe(false);
    expect(
      actionReceiptSchema.safeParse({ ...pause, action: 'run.cancel', status: 'cancelling' })
        .success,
    ).toBe(true);
  });
  it('pins output scope, input revisions and retained support', () => {
    expect(runOutputManifestSchema.parse(output)).toEqual(output);
    expect(runOutputManifestSchema.safeParse({ ...output, originatingScope: [] }).success).toBe(
      false,
    );
    expect(
      runOutputManifestSchema.safeParse({
        ...output,
        inputRevisions: [{ kind: 'company', companyId: 'co_1' }],
      }).success,
    ).toBe(false);
    expect(
      runOutputManifestSchema.safeParse({
        ...output,
        result: {
          ...output.result,
          citations: [{ sourceId: 'src_other', sourceRevision: 1, passageId: 'p_other' }],
        },
      }).success,
    ).toBe(false);
  });
  it('rejects untyped payloads, raw secrets and unsupported certainty', () => {
    expect(
      runOutputManifestSchema.safeParse({ ...output, apiKey: 'synthetic-secret' }).success,
    ).toBe(false);
    expect(
      runOutputManifestSchema.safeParse({
        ...output,
        result: { kind: 'answer', answerId: 'answer_1', payload: {} },
      }).success,
    ).toBe(false);
    expect(runOutputManifestSchema.safeParse({ ...output, status: 'partial' }).success).toBe(false);
    expect(
      runOutputManifestSchema.safeParse({
        ...output,
        result: {
          kind: 'support_check',
          checks: [
            { observationId: 'obs_1', status: 'user_verified', evidenceRefs: output.evidenceRefs },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it('retrieves dossiers and briefs by typed pinned read references', () => {
    const result = {
      kind: 'reference',
      action: 'company.get',
      target: { companyId: 'co_1' },
      revision: 2,
    };
    expect(runOutputManifestSchema.safeParse({ ...output, result }).success).toBe(true);
    expect(
      runOutputManifestSchema.safeParse({
        ...output,
        result: { ...result, action: 'company.research.start' },
      }).success,
    ).toBe(false);
    expect(
      runOutputManifestSchema.safeParse({
        ...output,
        result: { ...result, target: { path: 'C:\\private' } },
      }).success,
    ).toBe(false);
    expect(
      runOutputManifestSchema.safeParse({
        ...output,
        result: { ...result, action: 'report.get', target: { reportId: 'report_1' } },
      }).success,
    ).toBe(true);
  });
  it('supports pre-market scope work and failed work without inventing a result', () => {
    const draft = [{ kind: 'scope_draft', requestId: 'req_1', payloadHash: 'a'.repeat(64) }];
    const failed = {
      ...output,
      originatingScope: draft,
      inputRevisions: draft,
      status: 'failed',
      evidenceRefs: [],
      gaps: [{ code: 'provider_failed' }],
      result: { kind: 'no_result' },
    };
    expect(runOutputManifestSchema.safeParse(failed).success).toBe(true);
    expect(runOutputManifestSchema.safeParse({ ...failed, status: 'completed' }).success).toBe(
      false,
    );
  });
  it.each([
    ['market.create', 'market', {}],
    ['monitor.enable', 'schedule', {}],
    ['connection.grant', 'grant', {}],
    ['provider.configure', 'connection', {}],
    ['budget.approve', 'budget', {}],
    ['record.trash', 'tombstone', { kind: 'company', companyId: 'co_1' }],
  ])(
    'returns the exact created record for %s without treating its ID as authority',
    (action, kind, target) => {
      const { runId, ...base } = receipt;
      expect(runId).toBe('run_1');
      const write = { ...base, action, target, effect: 'write', status: 'applied' };
      expect(actionReceiptSchema.safeParse(write).success).toBe(false);
      expect(
        actionReceiptSchema.safeParse({
          ...write,
          createdRecord: { kind, id: 'created_1', revision: 1 },
        }).success,
      ).toBe(true);
      expect(
        actionReceiptSchema.safeParse({
          ...write,
          createdRecord: { kind: 'company', id: 'created_1', revision: 1 },
        }).success,
      ).toBe(false);
    },
  );
});
