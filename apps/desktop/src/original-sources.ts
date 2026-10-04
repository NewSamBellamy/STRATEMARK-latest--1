import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { OriginalSourceServices } from '@mi/research';
import { retrieveOriginalSource } from '@mi/research/original-source-node';

const ID = /^src_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_FILE_BYTES = 64 * 1024;
const receiptSchema = z.object({
  requestedUrl: z.string().max(2048), finalUrl: z.string().max(2048).optional(),
  status: z.enum(['retrieved', 'blocked', 'unavailable']), retrievedAt: z.string().datetime(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), text: z.string().max(4000).optional(),
  truncated: z.boolean().optional(), reason: z.string().max(256).optional(),
}).superRefine((receipt, ctx) => {
  if (receipt.status === 'retrieved' ? !receipt.text?.trim() || !receipt.contentHash || receipt.httpStatus !== 200
    : receipt.text !== undefined || receipt.contentHash !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid original-source outcome' });
  }
});
const attemptSchema = z.object({
  id: z.string().regex(ID), companyId: z.string().min(1).max(256), metricType: z.string().min(1).max(64),
  capturedAt: z.string().datetime(), receipts: z.array(receiptSchema).max(2),
});

/** Owned userData directory only. Renderer cannot choose paths or invoke fetch. */
export function createOriginalSourceServices(directory: string): OriginalSourceServices {
  const root = path.resolve(directory);
  return {
    retrieve: retrieveOriginalSource,
    async save(attempt) {
      const record = attemptSchema.parse(attempt);
      const json = JSON.stringify(record);
      if (Buffer.byteLength(json, 'utf8') > MAX_FILE_BYTES) throw new Error('Original source artifact exceeds size limit.');
      await mkdir(root, { recursive: true, mode: 0o700 });
      if ((await lstat(root)).isSymbolicLink()) throw new Error('Original source directory cannot be a symlink.');
      const temp = path.join(root, `${record.id}.${randomUUID()}.tmp`);
      const file = path.join(root, `${record.id}.json`);
      try {
        const handle = await open(temp, 'wx', 0o600);
        try { await handle.writeFile(json, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        // Publish a complete file atomically, refusing any existing artifact ID.
        await link(temp, file);
      } finally { await unlink(temp).catch(() => {}); }
    },
    async list(input) {
      if (!input.companyId) return [];
      let files: string[];
      try {
        if ((await lstat(root)).isSymbolicLink()) throw new Error('Original source directory cannot be a symlink.');
        files = await readdir(root);
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return [];
        throw error;
      }
      const records = [];
      for (const filename of files) {
        if (!filename.endsWith('.json') || !ID.test(filename.slice(0, -5))) continue;
        const file = path.join(root, filename);
        const info = await lstat(file);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Unreadable original source artifact.');
        const record = attemptSchema.parse(JSON.parse(await readFile(file, 'utf8')));
        if (`${record.id}.json` !== filename) throw new Error('Original source artifact identity mismatch.');
        if (record.companyId === input.companyId && (!input.metricType || record.metricType === input.metricType)) records.push(record);
      }
      const limit = Number.isFinite(input.limit) ? Math.min(10, Math.max(1, Math.floor(input.limit!))) : 4;
      return records.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id)).slice(0, limit);
    },
  };
}
