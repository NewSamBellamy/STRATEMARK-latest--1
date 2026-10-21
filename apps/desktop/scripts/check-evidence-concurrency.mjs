import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

// Real processes and production service; no model, network, credentials or GUI.
const desktop = fileURLToPath(new URL('../', import.meta.url));
const requireDesktop = createRequire(path.join(desktop, 'package.json'));
const { DatabaseSync } = createRequire(process.execPath)('node:sqlite');
const root = await mkdtemp(path.join(tmpdir(), 'stratemark-source-concurrency-'));
const worker = path.join(root, 'writer.cjs');
await build({ stdin: { contents: `
  import {createOriginalSourceServices} from ${JSON.stringify(path.join(desktop, 'src/original-sources.ts'))};
  import {createRequire} from 'node:module';
  import {randomUUID} from 'node:crypto';
  const {DatabaseSync}=createRequire(process.execPath)('node:sqlite');
  const prepare=DatabaseSync.prototype.prepare;
  // Observe the actual migration seam; the parent releases its SQLite barrier
  // only after BOTH processes have read the old version. Never alter results.
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(sql==='PRAGMA user_version'){
      const get=statement.get.bind(statement);
      statement.get=(...args)=>{const row=get(...args);if(row.user_version===0)console.log('VERSION_READ');return row};
    }
    return statement;
  };
  createOriginalSourceServices(process.argv[2]).save({id:'src_'+randomUUID(),companyId:'parallel',metricType:'employees',
    capturedAt:new Date().toISOString(),receipts:[{requestedUrl:'https://sec.gov/report',status:'unavailable',retrievedAt:new Date().toISOString()}]})
    .then(()=>console.log('SAVED')).catch(error=>{console.error(error.message);process.exitCode=1});
`, resolveDir: desktop, sourcefile: 'evidence-index-concurrency.ts', loader: 'ts' }, outfile: worker, bundle: true, platform: 'node', format: 'cjs' });
const db = new DatabaseSync(path.join(root, 'source-index.sqlite'), { timeout: 1000 });
db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;');
let ready = 0, released = false;
const children = [];
const release = () => { if (!released) { db.exec('COMMIT'); released = true; } };
const timer = setTimeout(() => { release(); for (const child of children) child.kill(); }, 5000);
try {
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn(requireDesktop('electron'), [worker, root], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    children.push(child);
    let output = '', observed = false;
    child.stdout.on('data', part => {
      output += part;
      if (!observed && output.includes('VERSION_READ')) { observed = true; if (++ready === 2) release(); }
    });
    child.stderr.on('data', part => { output += part; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output }));
  });
  const settled = await Promise.allSettled([launch(), launch()]);
  const results = settled.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
  assert.equal(ready, 2, 'Both writers must observe the old migration version');
  for (const result of results) assert.equal(result.code, 0, result.output);
  assert.equal(db.prepare("SELECT count(*) AS total FROM attempts WHERE state='ready'").get().total, 2);
  console.log('PASS: two Electron processes migrated together and retained both acknowledged artifacts.');
} finally {
  clearTimeout(timer); release(); db.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir()));
  assert(path.basename(root).startsWith('stratemark-source-concurrency-'));
  await rm(root, { recursive: true, force: true });
}
