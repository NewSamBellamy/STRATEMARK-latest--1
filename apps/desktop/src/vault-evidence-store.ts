/** Offline native evidence persistence. Not a semantic fact checker or access grant. */
import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import {
  compareRecordTimestamps,
  recordVersionSchema,
  sourceVersionRecordSchema,
  evidencePassageRecordSchema,
  numericObservationRecordSchema,
  observationComparisonKey,
} from '@mi/contracts';

const id = recordVersionSchema.innerType().shape.id;
const revision = recordVersionSchema.innerType().shape.revision;
const pageSchema = z
  .object({ limit: z.number().int().min(1).max(100).default(50), afterId: id.optional() })
  .strict();
const metricSchema = z
  .object({
    record: recordVersionSchema,
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(2000),
    unit: z.string().trim().min(1).max(64),
    currencyMode: z.enum(['required', 'none']),
    scopeKind: z.enum(['company', 'market']),
    periodKind: z.enum(['instant', 'interval']),
  })
  .strict();
type Source = z.infer<typeof sourceVersionRecordSchema>;
type Passage = z.infer<typeof evidencePassageRecordSchema>;
type Observation = z.infer<typeof numericObservationRecordSchema>;
type Version = z.infer<typeof recordVersionSchema>;
type Visibility = Source['visibilityScope'];
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export const evidenceSchemaSql = `
CREATE TABLE source_versions (
  id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), body TEXT NOT NULL CHECK(json_valid(body)),
  content TEXT CHECK(content IS NULL OR length(CAST(content AS BLOB))<=2000000), PRIMARY KEY(id,revision)
) STRICT;
CREATE TABLE passages (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision=1), body TEXT NOT NULL CHECK(json_valid(body)),
  source_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
  FOREIGN KEY(source_id,source_revision) REFERENCES source_versions(id,revision),
  UNIQUE(id,source_id,source_revision)
) STRICT;
CREATE TABLE metric_definitions (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision=1), body TEXT NOT NULL CHECK(json_valid(body))
) STRICT;
CREATE TABLE observations (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision=1), body TEXT NOT NULL CHECK(json_valid(body)),
  company_id TEXT NOT NULL REFERENCES companies(id), definition_id TEXT NOT NULL REFERENCES metric_definitions(id),
  comparison_key TEXT
) STRICT;
CREATE INDEX observations_company ON observations(company_id,id);
CREATE INDEX observations_comparison ON observations(comparison_key,id);
CREATE TABLE observation_evidence (
  observation_id TEXT NOT NULL REFERENCES observations(id), ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<100),
  source_id TEXT NOT NULL, source_revision INTEGER NOT NULL, passage_id TEXT NOT NULL,
  FOREIGN KEY(source_id,source_revision) REFERENCES source_versions(id,revision),
  FOREIGN KEY(passage_id,source_id,source_revision) REFERENCES passages(id,source_id,source_revision),
  PRIMARY KEY(observation_id,ordinal), UNIQUE(observation_id,source_id,source_revision,passage_id)
) STRICT;
${['source_versions', 'passages', 'metric_definitions', 'observations', 'observation_evidence']
  .map(
    (table) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Evidence is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Evidence is append-only'); END;`,
  )
  .join('')}
`;

/** Called only by the trusted native vault; the DB handle never crosses IPC. */
export function createEvidenceStore(
  db: DatabaseSync,
  vaultId: string,
  assertOpen: () => void,
  readRevision: () => number,
  assertWrite: () => void,
) {
  function checkVersion(value: Version, first = true) {
    if (value.vaultId !== vaultId) throw new Error('Evidence belongs to a different vault.');
    if (first && value.revision !== 1) throw new Error('Immutable evidence starts at revision 1.');
  }
  function decode<T>(
    row: Record<string, unknown> | undefined,
    schema: z.ZodType<T>,
    versionOf: (value: T) => Version,
  ): T | null {
    if (!row) return null;
    const value = schema.parse(JSON.parse(String(row.body)));
    const record = versionOf(value);
    if (record.vaultId !== vaultId || record.id !== row.id || record.revision !== row.revision)
      throw new Error('Stored evidence identity or revision does not match its vault.');
    return value;
  }
  function checkContent(record: Source, content: unknown): asserts content is string | null {
    const retained = record.retrievalStatus === 'retrieved' || record.retrievalStatus === 'partial';
    if (!retained) {
      if (content !== null || record.contentHash !== null)
        throw new Error('Failed retrieval cannot claim retained content.');
    } else {
      if (
        typeof content !== 'string' ||
        content.length === 0 ||
        Buffer.byteLength(content, 'utf8') > 2_000_000
      )
        throw new Error('Retained content must fit the 2000000-byte bound.');
      if (Buffer.from(content, 'utf8').toString('utf8') !== content)
        throw new Error('Retained source content must round-trip losslessly through UTF-8.');
      if (sha(content) !== record.contentHash)
        throw new Error('Retained source content hash mismatch.');
    }
  }
  function sourceVersion(sourceId: string, sourceRevision: number) {
    assertOpen();
    id.parse(sourceId);
    revision.parse(sourceRevision);
    const row = db
      .prepare('SELECT id,revision,body,content FROM source_versions WHERE id=? AND revision=?')
      .get(sourceId, sourceRevision);
    const record = decode(row, sourceVersionRecordSchema, (value) => value);
    if (!row || !record) return null;
    checkContent(record, row.content);
    return { record, content: row.content };
  }
  function readPassage(passageId: string): Passage | null {
    assertOpen();
    id.parse(passageId);
    const row = db
      .prepare('SELECT id,revision,body,source_id,source_revision FROM passages WHERE id=?')
      .get(passageId);
    const value = decode(row, evidencePassageRecordSchema, (item) => item);
    if (!row || !value) return null;
    if (value.sourceId !== row.source_id || value.sourceRevision !== row.source_revision)
      throw new Error('Stored passage source does not match its index.');
    const source = sourceVersion(value.sourceId, value.sourceRevision);
    checkPassage(value, source);
    return value;
  }
  function checkScope(scope: Visibility) {
    for (const [table, values] of [
      ['companies', scope.companyIds],
      ['markets', scope.marketIds],
    ] as const)
      for (const target of values)
        if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(target))
          throw new Error('Evidence scope references a missing record.');
  }
  function checkPassage(value: Passage, source: ReturnType<typeof sourceVersion>) {
    if (!source?.content) throw new Error('Passage requires retained source content.');
    if (value.contentHash !== sha(value.text)) throw new Error('Passage hash mismatch.');
    if (!source.content.includes(value.text))
      throw new Error('Passage text is not in the retained source content.');
    if (value.origin !== source.record.origin)
      throw new Error('Passage origin does not match its source.');
    if (
      value.visibilityScope.companyIds.some(
        (target) => !source.record.visibilityScope.companyIds.includes(target),
      ) ||
      value.visibilityScope.marketIds.some(
        (target) => !source.record.visibilityScope.marketIds.includes(target),
      )
    )
      throw new Error('Passage scope cannot expand its source scope.');
  }
  function write(operation: () => void) {
    assertOpen();
    assertWrite();
    db.exec('BEGIN IMMEDIATE;');
    try {
      assertWrite();
      operation();
      assertWrite();
      db.exec('UPDATE vault_meta SET revision=revision+1 WHERE singleton=1; COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  function readDefinition(definitionId: string) {
    assertOpen();
    id.parse(definitionId);
    return decode(
      db.prepare('SELECT id,revision,body FROM metric_definitions WHERE id=?').get(definitionId),
      metricSchema,
      (value) => value.record,
    );
  }
  function checkObservation(value: Observation) {
    const definition = readDefinition(value.metricDefinitionId);
    if (!definition) throw new Error('Observation requires a retained metric definition.');
    if (
      value.unit !== definition.unit ||
      value.scope.kind !== definition.scopeKind ||
      (value.period.kind !== 'unknown' && value.period.kind !== definition.periodKind)
    )
      throw new Error('Observation unit, scope or period is incompatible with its definition.');
    if ((definition.currencyMode === 'required') !== (value.currency !== null))
      throw new Error('Observation currency is incompatible with its definition.');
    if (!db.prepare('SELECT 1 FROM companies WHERE id=?').get(value.companyId))
      throw new Error('Observation company is missing.');
    if (value.scope.kind === 'company') {
      if (value.scope.id !== value.companyId)
        throw new Error('Company observation scope must match its company.');
    } else if (value.scope.kind === 'market') {
      if (
        !db
          .prepare('SELECT 1 FROM memberships WHERE company_id=? AND market_id=?')
          .get(value.companyId, value.scope.id)
      )
        throw new Error('Market observation requires company membership in that market.');
    } else throw new Error('This offline inventory does not support that observation scope yet.');
    for (const ref of value.evidenceRefs) {
      const passage = readPassage(ref.passageId);
      if (
        !passage ||
        passage.sourceId !== ref.sourceId ||
        passage.sourceRevision !== ref.sourceRevision
      )
        throw new Error('Observation evidence does not match the exact retained source version.');
      if (
        value.scope.kind === 'company'
          ? !passage.visibilityScope.companyIds.includes(value.companyId)
          : !passage.visibilityScope.marketIds.includes(value.scope.id)
      )
        throw new Error('Observation scope cannot expand private evidence scope.');
    }
  }
  function decodeObservation(row: Record<string, unknown>): Observation {
    const value = decode(row, numericObservationRecordSchema, (item) => item)!;
    if (
      row.company_id !== value.companyId ||
      row.definition_id !== value.metricDefinitionId ||
      row.comparison_key !== observationComparisonKey(value)
    )
      throw new Error('Stored observation dimensions do not match their index.');
    const refs = db
      .prepare(
        'SELECT source_id AS sourceId,source_revision AS sourceRevision,passage_id AS passageId FROM observation_evidence WHERE observation_id=? ORDER BY ordinal',
      )
      .all(value.id);
    if (JSON.stringify(refs) !== JSON.stringify(value.evidenceRefs))
      throw new Error('Stored observation evidence links do not match.');
    checkObservation(value);
    return value;
  }
  function observationPage(
    where: string,
    parameters: SQLInputValue[],
    options: z.input<typeof pageSchema>,
    compare = false,
  ) {
    assertOpen();
    const page = pageSchema.parse(options);
    db.exec('BEGIN;');
    try {
      const vaultRevision = readRevision();
      const rows = db
        .prepare(`SELECT * FROM observations WHERE ${where} AND id>? ORDER BY id LIMIT ?`)
        .all(...parameters, page.afterId ?? '', page.limit + 1);
      const items = rows.slice(0, page.limit).map(decodeObservation);
      const nextCursor = rows.length > page.limit ? items.at(-1)!.id : null;
      // The review flag and page describe the same read snapshot, including other pages.
      const count = compare
        ? db
            .prepare(
              `SELECT count(DISTINCT json_extract(body,'$.value')) AS count FROM observations WHERE ${where}`,
            )
            .get(...parameters)?.count
        : 0;
      const hasDifferentValues = typeof count === 'number' && count > 1;
      db.exec('COMMIT;');
      return { items, nextCursor, vaultRevision, hasDifferentValues };
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }
  return {
    saveSourceVersion(input: unknown, content: string | null, expectedRevision: number) {
      const value = sourceVersionRecordSchema.parse(input);
      checkVersion(value, false);
      checkContent(value, content);
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        value.revision !== expectedRevision + 1
      )
        throw new Error('Source revision must advance exactly once.');
      write(() => {
        checkScope(value.visibilityScope);
        const latestRow = db
          .prepare(
            'SELECT id,revision,body FROM source_versions WHERE id=? ORDER BY revision DESC LIMIT 1',
          )
          .get(value.id);
        const previous = decode(latestRow, sourceVersionRecordSchema, (item) => item);
        if ((previous?.revision ?? 0) !== expectedRevision)
          throw new Error('Source revision conflict. Reload before saving.');
        if (
          previous &&
          (previous.createdAt !== value.createdAt ||
            compareRecordTimestamps(previous.updatedAt, value.updatedAt) > 0)
        )
          throw new Error(
            'Source creation time is immutable and update time cannot move backwards.',
          );
        db.prepare('INSERT INTO source_versions(id,revision,body,content) VALUES(?,?,?,?)').run(
          value.id,
          value.revision,
          JSON.stringify(value),
          content,
        );
      });
    },
    getSourceVersion: sourceVersion,
    savePassage(input: unknown) {
      const value = evidencePassageRecordSchema.parse(input);
      checkVersion(value);
      write(() => {
        checkPassage(value, sourceVersion(value.sourceId, value.sourceRevision));
        db.prepare(
          'INSERT INTO passages(id,revision,body,source_id,source_revision) VALUES(?,?,?,?,?)',
        ).run(
          value.id,
          value.revision,
          JSON.stringify(value),
          value.sourceId,
          value.sourceRevision,
        );
      });
    },
    getPassage: readPassage,
    getMetricDefinition: readDefinition,
    saveMetricDefinition(input: unknown) {
      const value = metricSchema.parse(input);
      checkVersion(value.record);
      write(() => {
        if (readDefinition(value.record.id))
          throw new Error('Metric definition is immutable and already exists.');
        db.prepare('INSERT INTO metric_definitions VALUES(?,?,?)').run(
          value.record.id,
          1,
          JSON.stringify(value),
        );
      });
    },
    saveObservation(input: unknown) {
      const value = numericObservationRecordSchema.parse(input);
      checkVersion(value);
      write(() => {
        checkObservation(value);
        db.prepare(
          'INSERT INTO observations(id,revision,body,company_id,definition_id,comparison_key) VALUES(?,?,?,?,?,?)',
        ).run(
          value.id,
          1,
          JSON.stringify(value),
          value.companyId,
          value.metricDefinitionId,
          observationComparisonKey(value),
        );
        value.evidenceRefs.forEach((ref, ordinal) =>
          db
            .prepare('INSERT INTO observation_evidence VALUES(?,?,?,?,?)')
            .run(value.id, ordinal, ref.sourceId, ref.sourceRevision, ref.passageId),
        );
      });
    },
    listObservations(companyId: string, options: z.input<typeof pageSchema> = {}) {
      id.parse(companyId);
      return observationPage('company_id=?', [companyId], options);
    },
    comparableObservations(observationId: string, options: z.input<typeof pageSchema> = {}) {
      assertOpen();
      id.parse(observationId);
      const row = db.prepare('SELECT * FROM observations WHERE id=?').get(observationId);
      if (!row) throw new Error('Observation not found.');
      const key = observationComparisonKey(decodeObservation(row));
      // Differences are candidates for review, not a semantic adjudication of conflict.
      return observationPage('comparison_key=?', [key], options, true);
    },
  };
}
