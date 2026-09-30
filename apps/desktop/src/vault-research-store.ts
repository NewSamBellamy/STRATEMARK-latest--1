/** Typed retained research; no scheduler, semantic adjudication or connector authority. */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import {
  claimRecordSchema,
  findingRecordSchema,
  reportRecordSchema,
  recordVersionSchema,
  compareRecordTimestamps,
  type ClaimRecord,
  type FindingRecord,
  type ReportRecord,
} from '@mi/contracts';
import type { createEvidenceStore } from './vault-evidence-store';

type Records = { claim: ClaimRecord; finding: FindingRecord; report: ReportRecord };
type Kind = keyof Records;
type Scope = ReportRecord['scope'];
type Ref = ReportRecord['evidenceRefs'][number];
const tables = { claim: 'claims', finding: 'findings', report: 'reports' } as const;
const schemas = {
  claim: claimRecordSchema,
  finding: findingRecordSchema,
  report: reportRecordSchema,
};
const id = recordVersionSchema.innerType().shape.id;
const revision = recordVersionSchema.innerType().shape.revision.min(1);
const scopeSchema = reportRecordSchema.innerType().shape.scope;
const pageSchema = z
  .object({ limit: z.number().int().min(1).max(100).default(50), afterId: id.optional() })
  .strict();
const refKey = (ref: Ref) => JSON.stringify([ref.sourceId, ref.sourceRevision, ref.passageId]);

// The registry is only FK identity metadata, not a generic JSON record store.
// Record bodies stay in their typed tables and all writes share the owner fence.
export const researchSchemaSql = `
CREATE TABLE retained_record_versions (
  kind TEXT NOT NULL CHECK(kind IN ('company','market','claim','observation','finding','report')),
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(kind,id,revision)
) STRICT;
INSERT INTO retained_record_versions SELECT CASE kind WHEN 'companies' THEN 'company' ELSE 'market' END,id,revision
  FROM record_history WHERE kind IN ('companies','markets');
INSERT INTO retained_record_versions SELECT 'observation',id,revision FROM observations;
CREATE TRIGGER register_inventory_version AFTER INSERT ON record_history WHEN NEW.kind IN ('companies','markets') BEGIN
  INSERT INTO retained_record_versions VALUES(CASE NEW.kind WHEN 'companies' THEN 'company' ELSE 'market' END,NEW.id,NEW.revision); END;
CREATE TRIGGER register_observation_version AFTER INSERT ON observations BEGIN INSERT INTO retained_record_versions VALUES('observation',NEW.id,NEW.revision); END;
CREATE TABLE claims (
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000),
  company_id TEXT NOT NULL REFERENCES companies(id), scope_kind TEXT NOT NULL CHECK(scope_kind IN ('company','market')), scope_id TEXT NOT NULL,
  PRIMARY KEY(id,revision)
) STRICT;
CREATE TABLE findings (
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000),
  market_id TEXT NOT NULL REFERENCES markets(id), PRIMARY KEY(id,revision)
) STRICT;
CREATE TABLE reports (
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=1000000),
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('company','market')), scope_id TEXT NOT NULL,
  PRIMARY KEY(id,revision)
) STRICT;
CREATE TABLE research_evidence (
  kind TEXT NOT NULL CHECK(kind IN ('claim','finding','report')), id TEXT NOT NULL, revision INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<100), source_id TEXT NOT NULL, source_revision INTEGER NOT NULL, passage_id TEXT NOT NULL,
  FOREIGN KEY(kind,id,revision) REFERENCES retained_record_versions(kind,id,revision),
  FOREIGN KEY(source_id,source_revision) REFERENCES source_versions(id,revision),
  FOREIGN KEY(passage_id,source_id,source_revision) REFERENCES passages(id,source_id,source_revision),
  PRIMARY KEY(kind,id,revision,ordinal), UNIQUE(kind,id,revision,source_id,source_revision,passage_id)
) STRICT;
CREATE TABLE finding_companies (
  finding_id TEXT NOT NULL, finding_revision INTEGER NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<50), company_id TEXT NOT NULL REFERENCES companies(id),
  FOREIGN KEY(finding_id,finding_revision) REFERENCES findings(id,revision), PRIMARY KEY(finding_id,finding_revision,ordinal), UNIQUE(finding_id,finding_revision,company_id)
) STRICT;
CREATE TABLE report_inputs (
  report_id TEXT NOT NULL, report_revision INTEGER NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<100),
  input_kind TEXT NOT NULL, input_id TEXT NOT NULL, input_revision INTEGER NOT NULL,
  FOREIGN KEY(report_id,report_revision) REFERENCES reports(id,revision),
  FOREIGN KEY(input_kind,input_id,input_revision) REFERENCES retained_record_versions(kind,id,revision),
  PRIMARY KEY(report_id,report_revision,ordinal), UNIQUE(report_id,report_revision,input_kind,input_id,input_revision)
) STRICT;
CREATE INDEX claims_company ON claims(company_id,id,revision);
CREATE INDEX findings_market ON findings(market_id,id,revision);
CREATE INDEX reports_scope ON reports(scope_kind,scope_id,id,revision);
${(['claim', 'finding', 'report'] as const).map((kind) => `CREATE TRIGGER register_${kind}_version AFTER INSERT ON ${tables[kind]} BEGIN INSERT INTO retained_record_versions VALUES('${kind}',NEW.id,NEW.revision); END;`).join('\n')}
${[
  'retained_record_versions',
  'claims',
  'findings',
  'reports',
  'research_evidence',
  'finding_companies',
  'report_inputs',
]
  .map(
    (
      table,
    ) => `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Retained research is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retained research is append-only'); END;`,
  )
  .join('\n')}
`;

/** Internal adapter. Exact links and scope are checked, not whether prose is true. */
export function createResearchStore(
  db: DatabaseSync,
  vaultId: string,
  assertOpen: () => void,
  readRevision: () => number,
  assertWrite: () => void,
  evidence: Pick<ReturnType<typeof createEvidenceStore>, 'getPassage' | 'getObservation'>,
) {
  type Context = { active: Set<string>; count: number; cache: Map<string, Records[Kind]> };
  const context = (): Context => ({ active: new Set(), count: 0, cache: new Map() });
  const member = (companyId: string, marketId: string) =>
    Boolean(
      db
        .prepare('SELECT 1 FROM memberships WHERE company_id=? AND market_id=?')
        .get(companyId, marketId),
    );
  function checkScope(value: Scope) {
    const table = value.kind === 'company' ? 'companies' : 'markets';
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(value.id))
      throw new Error('Research scope references a missing record.');
  }
  function allows(target: Scope, input: Scope) {
    return (
      (target.kind === input.kind && target.id === input.id) ||
      (target.kind === 'market' && input.kind === 'company' && member(input.id, target.id))
    );
  }
  function checkEvidence(target: Scope, refs: Ref[], companySupportInMarket = false) {
    for (const ref of refs) {
      const passage = evidence.getPassage(ref.passageId);
      if (
        !passage ||
        passage.sourceId !== ref.sourceId ||
        passage.sourceRevision !== ref.sourceRevision
      )
        throw new Error(
          'Research evidence requires the exact retained source version and passage.',
        );
      const visible =
        target.kind === 'company'
          ? passage.visibilityScope.companyIds.includes(target.id)
          : passage.visibilityScope.marketIds.includes(target.id) ||
            (companySupportInMarket &&
              passage.visibilityScope.companyIds.some((companyId) => member(companyId, target.id)));
      if (!visible) throw new Error('Research scope cannot widen private evidence.');
    }
  }
  function checkInputs(report: ReportRecord, current: Context) {
    const retained = new Set(report.evidenceRefs.map(refKey));
    for (const pin of report.inputRevisions) {
      let inputScope: Scope;
      let refs: Ref[] = [];
      if (pin.kind === 'company' || pin.kind === 'market') {
        const kind = pin.kind === 'company' ? 'companies' : 'markets';
        const row = db
          .prepare('SELECT body FROM record_history WHERE kind=? AND id=? AND revision=?')
          .get(kind, pin.id, pin.revision);
        if (!row) throw new Error('Report input revision does not exist.');
        const parsed = JSON.parse(String(row.body)) as { record?: unknown };
        const version = recordVersionSchema.parse(parsed.record);
        if (
          version.vaultId !== vaultId ||
          version.id !== pin.id ||
          version.revision !== pin.revision
        )
          throw new Error('Report input version does not match its retained identity.');
        inputScope = { kind: pin.kind, id: pin.id };
      } else if (pin.kind === 'observation') {
        const observation = evidence.getObservation(pin.id);
        if (!observation || observation.revision !== pin.revision)
          throw new Error('Report observation input revision does not exist.');
        if (observation.scope.kind !== 'company' && observation.scope.kind !== 'market')
          throw new Error('Unsupported report observation scope.');
        inputScope = { kind: observation.scope.kind, id: observation.scope.id };
        refs = observation.evidenceRefs;
      } else {
        const input = read(pin.kind, pin.id, pin.revision, current);
        if (!input) throw new Error('Report input revision does not exist.');
        inputScope = 'marketId' in input ? { kind: 'market', id: input.marketId } : input.scope;
        refs = input.evidenceRefs;
      }
      if (!allows(report.scope, inputScope))
        throw new Error('Report scope cannot expand private input scope.');
      if (refs.some((ref) => !retained.has(refKey(ref))))
        throw new Error('Report must pin all transitive input evidence.');
    }
  }
  function checkRecord(value: Records[Kind], current: Context) {
    if ('companyId' in value) {
      checkScope({ kind: 'company', id: value.companyId });
      checkScope(value.scope);
      if (value.scope.kind === 'market' && !member(value.companyId, value.scope.id))
        throw new Error('Market claim requires company membership.');
      checkEvidence(value.scope, value.evidenceRefs);
    } else if ('marketId' in value) {
      checkScope({ kind: 'market', id: value.marketId });
      for (const companyId of value.companyIds)
        if (!member(companyId, value.marketId))
          throw new Error('Finding company must be a member of its market.');
      // A market finding needs its own market support, not borrowed company metrics.
      checkEvidence({ kind: 'market', id: value.marketId }, value.evidenceRefs);
    } else {
      checkScope(value.scope);
      checkInputs(value, current);
      checkEvidence(value.scope, value.evidenceRefs, true);
    }
  }
  function read<K extends Kind>(
    kind: K,
    recordId: string,
    requestedRevision?: number,
    current = context(),
  ): Records[K] | null {
    assertOpen();
    id.parse(recordId);
    if (requestedRevision !== undefined) revision.parse(requestedRevision);
    const row =
      requestedRevision === undefined
        ? db
            .prepare(`SELECT * FROM ${tables[kind]} WHERE id=? ORDER BY revision DESC LIMIT 1`)
            .get(recordId)
        : db
            .prepare(`SELECT * FROM ${tables[kind]} WHERE id=? AND revision=?`)
            .get(recordId, requestedRevision);
    if (!row) return null;
    const key = JSON.stringify([kind, recordId, row.revision]);
    if (current.active.has(key)) throw new Error('Report input graph contains a cycle.');
    const cached = current.cache.get(key);
    if (cached) return cached as Records[K];
    if (current.active.size >= 16 || ++current.count > 1000)
      throw new Error('Report input graph exceeds its validation bound.');
    const value = schemas[kind].parse(JSON.parse(String(row.body))) as Records[K];
    if (
      value.record.vaultId !== vaultId ||
      value.record.id !== row.id ||
      value.record.revision !== row.revision
    )
      throw new Error('Stored research record identity or revision does not match.');
    if (
      'marketId' in value
        ? value.marketId !== row.market_id
        : value.scope.id !== row.scope_id ||
          value.scope.kind !== row.scope_kind ||
          ('companyId' in value && value.companyId !== row.company_id)
    )
      throw new Error('Stored research scope does not match its index.');
    const refs = db
      .prepare(
        'SELECT source_id AS sourceId,source_revision AS sourceRevision,passage_id AS passageId FROM research_evidence WHERE kind=? AND id=? AND revision=? ORDER BY ordinal',
      )
      .all(kind, recordId, value.record.revision);
    if (JSON.stringify(refs) !== JSON.stringify(value.evidenceRefs))
      throw new Error('Stored research evidence index does not match.');
    if ('marketId' in value) {
      const companies = db
        .prepare(
          'SELECT company_id FROM finding_companies WHERE finding_id=? AND finding_revision=? ORDER BY ordinal',
        )
        .all(recordId, value.record.revision)
        .map((item) => item.company_id);
      if (JSON.stringify(companies) !== JSON.stringify(value.companyIds))
        throw new Error('Stored finding membership links do not match.');
    } else if (!('companyId' in value)) {
      const inputs = db
        .prepare(
          'SELECT input_kind AS kind,input_id AS id,input_revision AS revision FROM report_inputs WHERE report_id=? AND report_revision=? ORDER BY ordinal',
        )
        .all(recordId, value.record.revision);
      if (JSON.stringify(inputs) !== JSON.stringify(value.inputRevisions))
        throw new Error('Stored report input links do not match.');
    }
    current.active.add(key);
    try {
      checkRecord(value, current);
    } finally {
      current.active.delete(key);
    }
    current.cache.set(key, value);
    return value;
  }
  function save<K extends Kind>(kind: K, input: unknown, expectedRevision: number) {
    assertOpen();
    assertWrite();
    const value = schemas[kind].parse(input);
    if (value.record.vaultId !== vaultId) throw new Error('Research belongs to a different vault.');
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      value.record.revision !== expectedRevision + 1
    )
      throw new Error('Research revision must advance exactly once.');
    const body = JSON.stringify(value);
    if (
      Buffer.byteLength(body, 'utf8') > 1_000_000 ||
      Buffer.from(body, 'utf8').toString('utf8') !== body
    )
      throw new Error('Research record exceeds its lossless storage bound.');
    db.exec('BEGIN IMMEDIATE;');
    try {
      assertWrite();
      const previous = read(kind, value.record.id);
      if ((previous?.record.revision ?? 0) !== expectedRevision)
        throw new Error('Research revision conflict. Reload before saving.');
      if (previous) {
        const old = previous.record;
        if (
          old.createdAt !== value.record.createdAt ||
          compareRecordTimestamps(old.updatedAt, value.record.updatedAt) > 0
        )
          throw new Error(
            'Research creation time is immutable and update time cannot move backwards.',
          );
        const identityOf = (item: Records[Kind]) =>
          'companyId' in item
            ? [item.origin, item.companyId, item.scope.kind, item.scope.id]
            : 'marketId' in item
              ? [item.origin, item.marketId, item.kind]
              : [item.origin, item.scope.kind, item.scope.id];
        if (JSON.stringify(identityOf(previous)) !== JSON.stringify(identityOf(value)))
          throw new Error('Research origin, identity and scope are immutable.');
      }
      const validation = context();
      validation.active.add(JSON.stringify([kind, value.record.id, value.record.revision]));
      validation.count = 1;
      checkRecord(value, validation);
      if ('companyId' in value)
        db.prepare(
          'INSERT INTO claims(id,revision,body,company_id,scope_kind,scope_id) VALUES(?,?,?,?,?,?)',
        ).run(
          value.record.id,
          value.record.revision,
          body,
          value.companyId,
          value.scope.kind,
          value.scope.id,
        );
      else if ('marketId' in value)
        db.prepare('INSERT INTO findings(id,revision,body,market_id) VALUES(?,?,?,?)').run(
          value.record.id,
          value.record.revision,
          body,
          value.marketId,
        );
      else
        db.prepare(
          'INSERT INTO reports(id,revision,body,scope_kind,scope_id) VALUES(?,?,?,?,?)',
        ).run(value.record.id, value.record.revision, body, value.scope.kind, value.scope.id);
      for (const [ordinal, ref] of value.evidenceRefs.entries())
        db.prepare('INSERT INTO research_evidence VALUES(?,?,?,?,?,?,?)').run(
          kind,
          value.record.id,
          value.record.revision,
          ordinal,
          ref.sourceId,
          ref.sourceRevision,
          ref.passageId,
        );
      if ('marketId' in value)
        for (const [ordinal, companyId] of value.companyIds.entries())
          db.prepare('INSERT INTO finding_companies VALUES(?,?,?,?)').run(
            value.record.id,
            value.record.revision,
            ordinal,
            companyId,
          );
      else if (!('companyId' in value))
        for (const [ordinal, pin] of value.inputRevisions.entries())
          db.prepare('INSERT INTO report_inputs VALUES(?,?,?,?,?,?)').run(
            value.record.id,
            value.record.revision,
            ordinal,
            pin.kind,
            pin.id,
            pin.revision,
          );
      assertWrite();
      db.exec('UPDATE vault_meta SET revision=revision+1 WHERE singleton=1; COMMIT;');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK;');
      throw error;
    }
  }
  function page<K extends Kind>(
    kind: K,
    where: string,
    parameters: SQLInputValue[],
    options: z.input<typeof pageSchema>,
  ) {
    assertOpen();
    const selected = pageSchema.parse(options);
    db.exec('BEGIN;');
    try {
      const vaultRevision = readRevision();
      const rows = db
        .prepare(
          `SELECT r.id,r.revision FROM ${tables[kind]} r WHERE ${where} AND r.id>? AND r.revision=(SELECT max(latest.revision) FROM ${tables[kind]} latest WHERE latest.id=r.id) ORDER BY r.id LIMIT ?`,
        )
        .all(...parameters, selected.afterId ?? '', selected.limit + 1);
      const current = context();
      const items = rows
        .slice(0, selected.limit)
        .map((row) => read(kind, String(row.id), Number(row.revision), current)!);
      const nextCursor = rows.length > selected.limit ? items.at(-1)!.record.id : null;
      db.exec('COMMIT;');
      return { items, nextCursor, vaultRevision };
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK;');
      throw error;
    }
  }
  return {
    saveClaim: (input: unknown, expectedRevision: number) => save('claim', input, expectedRevision),
    saveFinding: (input: unknown, expectedRevision: number) =>
      save('finding', input, expectedRevision),
    saveReport: (input: unknown, expectedRevision: number) =>
      save('report', input, expectedRevision),
    getClaim: (recordId: string, selectedRevision?: number) =>
      read('claim', recordId, selectedRevision),
    getFinding: (recordId: string, selectedRevision?: number) =>
      read('finding', recordId, selectedRevision),
    getReport: (recordId: string, selectedRevision?: number) =>
      read('report', recordId, selectedRevision),
    listClaims(companyId: string, options: z.input<typeof pageSchema> = {}) {
      id.parse(companyId);
      return page('claim', 'r.company_id=?', [companyId], options);
    },
    listFindings(marketId: string, options: z.input<typeof pageSchema> = {}) {
      id.parse(marketId);
      return page('finding', 'r.market_id=?', [marketId], options);
    },
    listReports(scope: Scope, options: z.input<typeof pageSchema> = {}) {
      const selected = scopeSchema.parse(scope);
      return page(
        'report',
        'r.scope_kind=? AND r.scope_id=?',
        [selected.kind, selected.id],
        options,
      );
    },
  };
}
