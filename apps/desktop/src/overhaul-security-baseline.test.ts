/** G00 known gap: uses a synthetic bridge, never reads a stored credential. */
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, type PreloadRepositoryApi } from '@mi/contracts';

const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke, on: vi.fn(), removeListener: vi.fn() },
}));

describe('G00 UNRESOLVED baseline: renderer secret boundary', () => {
  it('forwards a durable command without a renderer-controlled caller identity', async () => {
    await import('./preload');
    const api = bridge.expose.mock.calls.find(
      ([name]) => name === 'mi',
    )?.[1] as PreloadRepositoryApi;
    // Main owns validation: the preload forwards exactly one untrusted payload.
    const request = { action: 'market.discovery.expand' } as Parameters<typeof api.acceptAction>[0];
    bridge.invoke.mockResolvedValueOnce({ actionId: 'act_saved' });
    expect(await api.acceptAction(request)).toEqual({ actionId: 'act_saved' });
    expect(bridge.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.acceptAction, request);
  });
  it('the renderer must not have a stored-plaintext-key retrieval method', async () => {
    await import('./preload');
    const exposed = bridge.expose.mock.calls.find(([name]) => name === 'miSecure')?.[1] as
      Record<string, unknown> | undefined;
    expect(exposed).toBeDefined();
    expect(exposed).not.toHaveProperty('getApiKey');
  });
});
