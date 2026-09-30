/** G00 known gap: uses a synthetic bridge, never reads a stored credential. */
import { describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke, on: vi.fn(), removeListener: vi.fn() },
}));

describe('G00 UNRESOLVED baseline: renderer secret boundary', () => {
  it('the renderer must not have a stored-plaintext-key retrieval method', async () => {
    await import('./preload');
    const exposed = bridge.expose.mock.calls.find(([name]) => name === 'miSecure')?.[1] as
      Record<string, unknown> | undefined;
    expect(exposed).toBeDefined();
    expect(exposed).not.toHaveProperty('getApiKey');
  });
});
