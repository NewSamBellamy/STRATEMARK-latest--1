import { describe, expect, it } from 'vitest';
import type { ShareSnapshot } from '@mi/contracts';
import { MAX_INFLATED_BYTES, fromBase64Url, packSnapshot, snapshotFingerprint, toBase64, toBase64Url, unpackSnapshotText } from './wire';

const snapshot = (over: Partial<ShareSnapshot> = {}): ShareSnapshot => ({
  v: 1, kind: 'deck', focusCardId: null, sharedAt: '2026-10-19T10:00:00.000Z', markets: [], decks: [], companies: [], metrics: [], cards: [], viceClaims: [], dashboards: {},
  ...over,
} as ShareSnapshot);

describe('the wire format for a share', () => {
  it('round-trips a snapshot, compressed and as URL-safe text', async () => {
    const big = snapshot({ markets: [{ id: 'm', name: 'Meal kits '.repeat(2000) } as never] });
    const packed = await packSnapshot(big);
    expect(packed).toMatch(/^z[A-Za-z0-9_-]+$/);
    expect(packed.length).toBeLessThan(JSON.stringify(big).length / 4);
    expect(JSON.parse((await unpackSnapshotText(packed))!)).toEqual(big);
  });

  it('keeps accents and symbols exactly', async () => {
    const text = 'Crédit Agricole — 30% of “Zürich”: ¥5m, 日本';
    const back = await unpackSnapshotText(await packSnapshot(snapshot({ markets: [{ id: 'x', name: text } as never] })));
    expect(JSON.parse(back!).markets[0].name).toBe(text);
  });

  it('reads the plain form too, and refuses anything it did not make', async () => {
    const plain = `j${toBase64Url(new TextEncoder().encode('{"a":1}'))}`;
    expect(await unpackSnapshotText(plain)).toBe('{"a":1}');
    for (const bad of ['', 'x', 'zzzz', 'z!!!', 'jnot-base64!!', 'q123', `z${toBase64Url(new Uint8Array([1, 2, 3, 4, 5]))}`]) {
      expect(await unpackSnapshotText(bad), bad).toBeNull();
    }
  });

  it('will not inflate a small payload into an enormous one', async () => {
    // 80 MB of zeros deflates to about 80 KB: a hostile share could be that small on the wire.
    const zeros = new Uint8Array(MAX_INFLATED_BYTES + 16 * 1024 * 1024);
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    const reading = new Response(stream.readable).arrayBuffer();
    await writer.write(zeros);
    await writer.close();
    const compressed = new Uint8Array(await reading);
    expect(compressed.byteLength).toBeLessThan(200_000);
    expect(await unpackSnapshotText(`z${toBase64Url(compressed)}`)).toBeNull();
  }, 60_000);

  it('converts bytes to base64 and base64url and back', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_unused, i) => (i * 7) % 256);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    expect(toBase64Url(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(toBase64(new Uint8Array([251, 255, 254]))).toBe('+//+');
    expect(toBase64Url(new Uint8Array(0))).toBe('');
  });
});

describe('snapshotFingerprint', () => {
  it('ignores when the snapshot was exported, and notices any change to the research', () => {
    const a = snapshot();
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint({ ...a, sharedAt: '2027-01-01T00:00:00.000Z' }));
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(snapshot({ markets: [{ id: 'm', name: 'Changed' } as never] })));
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint({ ...a, kind: 'card' }));
  });
});
