import { describe, expect, it } from 'vitest';
import { claimRecordSchema, findingRecordSchema, reportRecordSchema } from './vault-research';

const at = '2026-09-30T12:00:00Z';
const record = {
  contractVersion: '1',
  vaultId: 'vault_a',
  id: 'rec_a',
  revision: 1,
  createdAt: at,
  updatedAt: at,
};
const evidence = { sourceId: 'src_a', sourceRevision: 1, passageId: 'pass_a' };
const claim = {
  record,
  companyId: 'co_a',
  scope: { kind: 'company', id: 'co_a' },
  text: 'Synthetic product description.',
  eventAt: null,
  origin: 'web',
  support: 'supported',
  evidenceRefs: [evidence],
};
const finding = {
  record,
  marketId: 'mkt_a',
  kind: 'barrier',
  title: 'Synthetic barrier',
  summary: 'Synthetic retained finding.',
  companyIds: ['co_a'],
  eventAt: null,
  origin: 'web',
  state: 'reported',
  riskStatus: null,
  evidenceRefs: [evidence],
};
const report = {
  record,
  scope: { kind: 'market', id: 'mkt_a' },
  title: 'Synthetic report',
  markdown: 'Retained research prose.',
  origin: 'web',
  status: 'completed',
  inputRevisions: [{ kind: 'company', id: 'co_a', revision: 1 }],
  evidenceRefs: [evidence],
  gaps: [],
};

describe('versioned research record shapes, not semantic verification', () => {
  it('accepts typed claims, findings and reports with exact support and input revisions', () => {
    expect(claimRecordSchema.parse(claim)).toEqual(claim);
    expect(findingRecordSchema.parse(finding)).toEqual(finding);
    expect(reportRecordSchema.parse(report)).toEqual(report);
  });
  it('refuses unearned support and local attestation metadata', () => {
    expect(claimRecordSchema.safeParse({ ...claim, evidenceRefs: [] }).success).toBe(false);
    expect(claimRecordSchema.safeParse({ ...claim, support: 'user_verified' }).success).toBe(false);
    expect(findingRecordSchema.safeParse({ ...finding, evidenceRefs: [] }).success).toBe(false);
    expect(reportRecordSchema.safeParse({ ...report, userVerified: true }).success).toBe(false);
  });
  it('retains explicit report gaps instead of claiming unsupported completion', () => {
    expect(reportRecordSchema.safeParse({ ...report, evidenceRefs: [] }).success).toBe(false);
    expect(reportRecordSchema.safeParse({ ...report, inputRevisions: [] }).success).toBe(false);
    expect(reportRecordSchema.safeParse({ ...report, status: 'partial', gaps: [] }).success).toBe(
      false,
    );
    expect(
      reportRecordSchema.safeParse({
        ...report,
        status: 'partial',
        evidenceRefs: [],
        inputRevisions: [],
        gaps: ['missing_evidence'],
      }).success,
    ).toBe(true);
  });
  it('does not promote imported support or reports into trusted local results', () => {
    expect(claimRecordSchema.safeParse({ ...claim, origin: 'imported' }).success).toBe(false);
    expect(
      claimRecordSchema.safeParse({ ...claim, origin: 'imported', support: 'reported' }).success,
    ).toBe(true);
    expect(
      findingRecordSchema.safeParse({ ...finding, origin: 'imported', state: 'supported' }).success,
    ).toBe(false);
    expect(reportRecordSchema.safeParse({ ...report, origin: 'imported' }).success).toBe(false);
    expect(
      reportRecordSchema.safeParse({
        ...report,
        origin: 'imported',
        status: 'partial',
        gaps: ['missing_evidence'],
      }).success,
    ).toBe(true);
    expect(
      findingRecordSchema.safeParse({
        ...finding,
        origin: 'imported',
        kind: 'risk',
        riskStatus: 'resolved',
        state: 'reported',
      }).success,
    ).toBe(true);
  });
  it('requires attributable risk status without disguising an allegation as resolution', () => {
    expect(findingRecordSchema.safeParse({ ...finding, kind: 'risk' }).success).toBe(false);
    expect(
      findingRecordSchema.safeParse({ ...finding, kind: 'risk', riskStatus: 'allegation' }).success,
    ).toBe(true);
    expect(
      findingRecordSchema.safeParse({
        ...finding,
        kind: 'risk',
        state: 'resolved',
        riskStatus: 'allegation',
      }).success,
    ).toBe(false);
    expect(findingRecordSchema.safeParse({ ...finding, riskStatus: 'allegation' }).success).toBe(
      false,
    );
  });
  it('refuses duplicate pins, duplicate evidence, inconsistent scope and invalid revisions', () => {
    expect(
      reportRecordSchema.safeParse({
        ...report,
        inputRevisions: [report.inputRevisions[0], report.inputRevisions[0]],
      }).success,
    ).toBe(false);
    expect(
      claimRecordSchema.safeParse({ ...claim, evidenceRefs: [evidence, evidence] }).success,
    ).toBe(false);
    expect(
      claimRecordSchema.safeParse({ ...claim, scope: { kind: 'company', id: 'co_other' } }).success,
    ).toBe(false);
    expect(
      claimRecordSchema.safeParse({ ...claim, record: { ...record, revision: 0 } }).success,
    ).toBe(false);
    expect(
      findingRecordSchema.safeParse({ ...finding, companyIds: ['co_a', 'co_a'] }).success,
    ).toBe(false);
  });
});
