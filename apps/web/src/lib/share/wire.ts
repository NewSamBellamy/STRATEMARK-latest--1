/**
 * How a shared snapshot travels to the share Worker and back: the snapshot as
 * JSON, deflated in the browser, as URL-safe base64 with a one-letter marker
 * (`z` deflated, `j` plain for a browser with no compression). The Worker
 * stores the string without reading it, so research is never parsed server side.
 */
import type { ShareSnapshot } from '@mi/contracts';

export function toBase64Url(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + (b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Largest text we will try to inflate: far above any real snapshot, far below what could exhaust memory. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * Pump bytes through a (de)compression stream, reading while writing so backpressure cannot stall it, and stopping
 * at `maxOut` bytes of output: a small hostile payload that inflates without end must not exhaust the viewer's memory.
 */
async function pipe(bytes: Uint8Array, transform: { readable: ReadableStream; writable: WritableStream }, maxOut = MAX_INFLATED_BYTES): Promise<Uint8Array> {
  const reader = transform.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const reading = (async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxOut) {
        await reader.cancel();
        throw new Error('The shared research is larger than this page will open.');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
  })();
  reading.catch(() => undefined); // surfaced by the await below; this only keeps a rejection from being reported twice
  const writing = (async () => {
    const writer = transform.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
  })();
  writing.catch(() => undefined);
  const out = await reading;
  await writing;
  return out;
}

export async function packSnapshot(snapshot: ShareSnapshot): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(snapshot));
  if (typeof CompressionStream !== 'undefined') return `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  return `j${toBase64Url(json)}`;
}

/** The snapshot's text, or null when the string is not one we made. Shape is checked by the caller. */
export async function unpackSnapshotText(packed: string): Promise<string | null> {
  try {
    const mode = packed.charAt(0);
    const bytes = fromBase64Url(packed.slice(1));
    if (mode === 'j') return new TextDecoder().decode(bytes);
    if (mode !== 'z' || typeof DecompressionStream === 'undefined') return null;
    const out = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return out.byteLength > MAX_INFLATED_BYTES ? null : new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

/** A cheap fingerprint of a snapshot without its export time, so an unchanged deck reuses its link. */
export function snapshotFingerprint(snapshot: ShareSnapshot): string {
  const text = JSON.stringify({ ...snapshot, sharedAt: '' });
  // cyrb53: not a security hash, only a quick way to tell "same research" from "changed".
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}-${text.length.toString(36)}`;
}
