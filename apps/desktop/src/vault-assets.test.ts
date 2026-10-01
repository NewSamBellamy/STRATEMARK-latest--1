import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openAssetStore } from './vault-assets';

const directories: string[] = [];
const maxBytes = 8 * 1024 * 1024;

function location() {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-assets-test-'));
  directories.push(directory);
  return directory;
}

function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assetPath(root: string, sha256: string) {
  return path.join(root, sha256);
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('bounded local vault asset store', () => {
  it('publishes content by SHA-256 and reads verified bytes, including duplicate publishes', () => {
    const root = location();
    const store = openAssetStore(root, () => {});
    const bytes = Buffer.from('synthetic offline asset');
    const ref = store.publish(bytes);

    expect(ref).toEqual({ sha256: hash(bytes), byteLength: bytes.length });
    expect(store.read(ref)).toEqual(bytes);
    expect(store.verify(ref)).toBeUndefined();
    expect(store.publish(bytes)).toEqual(ref);
    expect(readFileSync(assetPath(root, ref.sha256))).toEqual(bytes);
    expect(lstatSync(root).isDirectory()).toBe(true);
  });

  it('rejects invalid references and refuses length or hash corruption', () => {
    const root = location();
    const store = openAssetStore(root, () => {});
    const bytes = Buffer.from('known bytes');
    const ref = store.publish(bytes);

    expect(() => store.read({ ...ref, byteLength: ref.byteLength + 1 })).toThrow();
    expect(() => store.read({ ...ref, sha256: ref.sha256.toUpperCase() })).toThrow();
    expect(() => store.read({ ...ref, sha256: '../escape'.padEnd(64, 'a') })).toThrow();

    writeFileSync(assetPath(root, ref.sha256), Buffer.from('corrupt data'));
    expect(() => store.read(ref)).toThrow();
    expect(() => store.verify(ref)).toThrow();
  });

  it('enforces the 8 MiB per-asset bound without publishing an oversized asset', () => {
    const root = location();
    const store = openAssetStore(root, () => {});
    const atLimit = Buffer.alloc(maxBytes, 7);
    const oversized = Buffer.alloc(maxBytes + 1, 7);

    expect(store.publish(atLimit).byteLength).toBe(maxBytes);
    expect(() => store.publish(oversized)).toThrow();
    expect(readdirSync(root)).toEqual([hash(atLimit)]);
  });

  it('refuses existing nonregular, hard-linked, and corrupt hash entries without overwriting them', () => {
    const root = location();
    const store = openAssetStore(root, () => {});
    const bytes = Buffer.from('immutable asset bytes');
    const ref = { sha256: hash(bytes), byteLength: bytes.length };
    const corrupt = Buffer.from('different bytes');

    writeFileSync(assetPath(root, ref.sha256), corrupt);
    expect(() => store.publish(bytes)).toThrow();
    expect(readFileSync(assetPath(root, ref.sha256))).toEqual(corrupt);

    rmSync(assetPath(root, ref.sha256));
    mkdirSync(assetPath(root, ref.sha256));
    expect(() => store.read(ref)).toThrow();
    rmSync(assetPath(root, ref.sha256), { recursive: true });

    writeFileSync(assetPath(root, ref.sha256), bytes);
    linkSync(assetPath(root, ref.sha256), path.join(root, 'external-alias'));
    expect(() => store.read(ref)).toThrow();
    expect(() => store.publish(bytes)).toThrow();
    expect(readFileSync(assetPath(root, ref.sha256))).toEqual(bytes);
  });

  it('refuses a symlink or reparse-point root', () => {
    const parent = location();
    const target = path.join(parent, 'target');
    const rootLink = path.join(parent, 'root-link');
    mkdirSync(target);
    symlinkSync(target, rootLink, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => openAssetStore(rootLink, () => {})).toThrow();
  });

  it('detects root replacement after opening and writes nothing into the replacement', () => {
    const parent = location();
    const root = path.join(parent, 'assets');
    const moved = path.join(parent, 'assets-moved');
    mkdirSync(root);
    const store = openAssetStore(root, () => {});
    renameSync(root, moved);
    mkdirSync(root);
    const bytes = Buffer.from('must not land in substituted root');

    expect(() => store.publish(bytes)).toThrow();
    expect(readdirSync(root)).toEqual([]);
  });

  it('checks captured write authority at entry and immediately before publication', () => {
    const root = location();
    let checks = 0;
    const store = openAssetStore(root, () => {
      checks += 1;
      if (checks === 2) throw new Error('writer generation is stale');
    });
    const bytes = Buffer.from('stale publication must remain absent');

    expect(() => store.publish(bytes)).toThrow(/stale/i);
    expect(checks).toBe(2);
    expect(readdirSync(root)).toEqual([]);
  });
  it('cannot create an asset root using stale write authority', () => {
    const parent = location();
    const root = path.join(parent, 'assets');
    expect(() =>
      openAssetStore(root, () => {
        throw new Error('stale owner');
      }),
    ).toThrow(/stale/i);
    expect(readdirSync(parent)).toEqual([]);
  });
  it('refuses tampered flushed temp bytes before linking them into the content store', () => {
    const root = location();
    let checks = 0;
    const store = openAssetStore(root, () => {
      if (++checks === 2) {
        const temp = readdirSync(root).find((name) => name.startsWith('.tmp-'))!;
        writeFileSync(path.join(root, temp), 'modified temp');
      }
    });
    expect(() => store.publish(Buffer.from('original bytes'))).toThrow();
    expect(readdirSync(root)).toEqual([]);
  });
});
