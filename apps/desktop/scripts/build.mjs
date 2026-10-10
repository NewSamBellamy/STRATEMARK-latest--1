import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const web = path.resolve(desktop, '../web');
const webRequire = createRequire(path.join(web, 'package.json'));
if (!process.argv.includes('--main-only')) {
  // Cross-platform environment setup; never bundle hosted credentials into desktop.
  const env = { ...process.env, ELECTRON: '1', VITE_DESKTOP: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_FIREBASE') || key.startsWith('VITE_GOOGLE') || key.startsWith('VITE_SENTINEL')) delete env[key];
  }
  for (const args of [
    [webRequire.resolve('typescript/bin/tsc'), '--noEmit'],
    [path.join(path.dirname(webRequire.resolve('vite/package.json')), 'bin/vite.js'), 'build'],
  ]) {
    const result = spawnSync(process.execPath, args, { cwd: web, env, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
await build({
  absWorkingDir: desktop,
  entryPoints: ['src/main.ts', 'src/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
});
