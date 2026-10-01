import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const FAILURE_MESSAGE = 'Asset store operation failed.';
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export type AssetRef = { sha256: string; byteLength: number };

class StoreFailure extends Error {
  constructor() {
    super(FAILURE_MESSAGE);
  }
}

function fail(): never {
  throw new StoreFailure();
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => {
    const result = path.normalize(value);
    return process.platform === 'win32' ? result.toLowerCase() : result;
  };
  return normalize(left) === normalize(right);
}

function inspectRoot(root: string) {
  try {
    const stat = lstatSync(root, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();

    const realRoot = realpathSync.native(root);
    if (process.platform === 'win32') {
      const realParent = realpathSync.native(path.dirname(root));
      const expectedRoot = path.join(realParent, path.basename(root));
      if (!samePath(realRoot, expectedRoot)) fail();
    }

    return { dev: stat.dev, ino: stat.ino, realRoot };
  } catch (error) {
    if (error instanceof StoreFailure) throw error;
    fail();
  }
}

function validRef(ref: AssetRef): AssetRef {
  if (
    !ref ||
    typeof ref !== 'object' ||
    typeof ref.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(ref.sha256) ||
    !Number.isSafeInteger(ref.byteLength) ||
    ref.byteLength < 0 ||
    ref.byteLength > MAX_ASSET_BYTES
  )
    fail();
  return ref;
}

export function openAssetStore(rootAbsolutePath: string, assertWrite: () => void) {
  if (typeof rootAbsolutePath !== 'string' || !path.isAbsolute(rootAbsolutePath)) fail();
  if (typeof assertWrite !== 'function') fail();

  const root = path.resolve(rootAbsolutePath);
  if (!existsSync(root)) {
    assertWrite();
    try {
      // The trusted caller selects an existing parent, not an arbitrary directory tree.
      mkdirSync(root, { mode: 0o700 });
    } catch {
      fail();
    }
  }

  const initialRoot = inspectRoot(root);
  const assertRoot = () => {
    const current = inspectRoot(root);
    if (
      current.dev !== initialRoot.dev ||
      current.ino !== initialRoot.ino ||
      !samePath(current.realRoot, initialRoot.realRoot)
    )
      fail();
  };

  function read(refInput: AssetRef): Buffer {
    const ref = validRef(refInput);
    assertRoot();
    const file = path.join(root, ref.sha256);
    let descriptor: number | undefined;
    try {
      const before = lstatSync(file, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1n ||
        before.size !== BigInt(ref.byteLength)
      )
        fail();

      descriptor = openSync(file, constants.O_RDONLY | NOFOLLOW);
      assertRoot();
      const opened = fstatSync(descriptor, { bigint: true });
      if (
        !opened.isFile() ||
        opened.size !== BigInt(ref.byteLength) ||
        opened.nlink !== 1n ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino
      )
        fail();

      const bytes = readFileSync(descriptor);
      assertRoot();
      if (
        bytes.byteLength !== ref.byteLength ||
        createHash('sha256').update(bytes).digest('hex') !== ref.sha256
      )
        fail();
      closeSync(descriptor);
      descriptor = undefined;
      return bytes;
    } catch (error) {
      if (error instanceof StoreFailure) throw error;
      return fail();
    } finally {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // A failed close must not mask the generic storage error or verified read.
        }
      }
    }
  }

  function publish(input: Uint8Array): AssetRef {
    assertWrite();
    if (!(input instanceof Uint8Array) || input.byteLength > MAX_ASSET_BYTES) fail();

    const bytes = Buffer.from(input);
    const ref = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
    };
    const finalPath = path.join(root, ref.sha256);
    const tempPath = path.join(root, `.tmp-${randomBytes(16).toString('hex')}`);
    let descriptor: number | undefined;
    let tempIdentity: { dev: bigint; ino: bigint } | undefined;

    const removeOwnTemp = () => {
      if (!tempIdentity) return;
      try {
        assertRoot();
        const temp = lstatSync(tempPath, { bigint: true });
        if (
          temp.isFile() &&
          !temp.isSymbolicLink() &&
          temp.dev === tempIdentity.dev &&
          temp.ino === tempIdentity.ino
        )
          unlinkSync(tempPath);
      } catch {
        // Preserve unrelated files and leave an orphan if the root or temp was replaced.
      }
    };

    try {
      assertRoot();
      descriptor = openSync(tempPath, 'wx', 0o600);
      const created = fstatSync(descriptor, { bigint: true });
      tempIdentity = { dev: created.dev, ino: created.ino };
      if (!created.isFile() || created.nlink !== 1n) fail();
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Best-effort close before removing only the temp created by this call.
        }
      }
      removeOwnTemp();
      if (error instanceof StoreFailure) throw error;
      fail();
    }

    try {
      assertRoot();
      const temp = lstatSync(tempPath, { bigint: true });
      if (
        !tempIdentity ||
        !temp.isFile() ||
        temp.isSymbolicLink() ||
        temp.nlink !== 1n ||
        temp.dev !== tempIdentity.dev ||
        temp.ino !== tempIdentity.ino
      )
        fail();
    } catch (error) {
      removeOwnTemp();
      if (error instanceof StoreFailure) throw error;
      fail();
    }

    try {
      assertWrite();
    } catch (error) {
      removeOwnTemp();
      throw error;
    }

    try {
      assertRoot();
      const temp = lstatSync(tempPath, { bigint: true });
      if (
        !tempIdentity ||
        !temp.isFile() ||
        temp.isSymbolicLink() ||
        temp.nlink !== 1n ||
        temp.dev !== tempIdentity.dev ||
        temp.ino !== tempIdentity.ino
      )
        fail();
      if (
        temp.size !== BigInt(ref.byteLength) ||
        createHash('sha256').update(readFileSync(tempPath)).digest('hex') !== ref.sha256
      )
        fail();
      linkSync(tempPath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
        try {
          const existing = read(ref);
          if (existing.equals(bytes)) {
            removeOwnTemp();
            return ref;
          }
        } catch {
          // Existing invalid content is deliberately indistinguishable from other failures.
        }
      }
      removeOwnTemp();
      if (error instanceof StoreFailure) throw error;
      fail();
    }

    removeOwnTemp();
    // A failed temp unlink leaves a hard link: don't acknowledge an unreadable asset.
    read(ref);
    return ref;
  }

  return {
    publish,
    read,
    verify(ref: AssetRef) {
      read(ref);
    },
  };
}
