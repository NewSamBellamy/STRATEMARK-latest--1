import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OG_MAX_BYTES, renderOgImage } from './ogImage';
import type { OgLayout } from './bundle';

/** A canvas that draws nothing and says how large its picture would be: wide pictures are big, the smaller one is small. */
function fakeCanvas(bigWhenWide: number, small: number) {
  const anything: unknown = new Proxy(function noop() { /* a drawing call */ }, {
    get: (_target, key) => (key === 'width' ? 10 : anything),
    apply: () => anything,
    set: () => true,
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => anything,
    toBlob(done: (blob: unknown) => void) {
      const size = this.width >= 1200 ? bigWhenWide : small;
      done({ arrayBuffer: async () => new Uint8Array(size).buffer });
    },
  };
  return canvas;
}

const layout: OgLayout = { eyebrow: 'CARD', title: 'Acme', subtitle: '', slots: [], names: [], faces: [] };

/** jsdom never finishes loading a picture: the brand mark "loads" at once. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 8;
  naturalHeight = 8;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}

describe('the size of the preview picture', () => {
  beforeEach(() => { vi.stubGlobal('Image', FakeImage); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('is sent at full size when it fits under the Worker limit', async () => {
    const canvases: Array<ReturnType<typeof fakeCanvas>> = [];
    vi.spyOn(document, 'createElement').mockImplementation((() => {
      const c = fakeCanvas(OG_MAX_BYTES - 1, 5);
      canvases.push(c);
      return c;
    }) as unknown as typeof document.createElement);
    const png = await renderOgImage(layout);
    expect(png!.byteLength).toBe(OG_MAX_BYTES - 1);
    expect(canvases).toHaveLength(1);
    expect(canvases[0]!.width).toBe(1200);
  });

  it('is drawn again smaller when the full-size picture would be too large to send', async () => {
    const canvases: Array<ReturnType<typeof fakeCanvas>> = [];
    vi.spyOn(document, 'createElement').mockImplementation((() => {
      const c = fakeCanvas(OG_MAX_BYTES + 1, 120_000);
      canvases.push(c);
      return c;
    }) as unknown as typeof document.createElement);
    const png = await renderOgImage(layout);
    expect(canvases).toHaveLength(2);
    expect(canvases[1]!.width).toBeLessThan(1200);
    expect(canvases[1]!.width / canvases[1]!.height).toBeCloseTo(1200 / 630, 1);
    expect(png!.byteLength).toBe(120_000);
  });

  it('stays under what the Worker accepts: 500,000 base64 characters is 375,000 bytes', () => {
    expect(OG_MAX_BYTES * (4 / 3)).toBeLessThan(500_000);
  });
});
