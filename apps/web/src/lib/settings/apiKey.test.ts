import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecureApi } from '@mi/contracts';

function bridge(key = ''): SecureApi {
  return {
    getApiKey: vi.fn().mockResolvedValue(key),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    exportResearch: vi.fn(), importResearch: vi.fn(), getResearchStorageInfo: vi.fn(),
  };
}
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { delete window.miSecure; vi.restoreAllMocks(); });

describe('desktop key persistence', () => {
  it('does not persist plaintext in browser storage', async () => {
    window.miSecure = bridge();
    const { useApiKey, apiKeyReady } = await import('./apiKey');
    await apiKeyReady;
    await useApiKey.getState().setApiKey('test-key');
    expect(window.miSecure.setApiKey).toHaveBeenCalledWith('test-key');
    expect(localStorage.getItem('mi.geminiApiKey')).toBeNull();
    expect(useApiKey.getState().hasKey).toBe(true);
  });
  it('does not claim success when encrypted storage fails', async () => {
    window.miSecure = bridge();
    const { useApiKey, apiKeyReady } = await import('./apiKey');
    await apiKeyReady;
    vi.mocked(window.miSecure.setApiKey).mockRejectedValue(new Error('keyring unavailable'));
    await expect(useApiKey.getState().setApiKey('test-key')).rejects.toThrow();
    expect(useApiKey.getState().hasKey).toBe(false);
    expect(localStorage.getItem('mi.geminiApiKey')).toBeNull();
  });
  it('migrates legacy keys only after secure persistence succeeds', async () => {
    localStorage.setItem('mi.apiKey', 'legacy-test-key');
    window.miSecure = bridge();
    const { useApiKey, apiKeyReady } = await import('./apiKey');
    await apiKeyReady;
    expect(window.miSecure.setApiKey).toHaveBeenCalledWith('legacy-test-key');
    expect(localStorage.getItem('mi.apiKey')).toBeNull();
    expect(useApiKey.getState().apiKey).toBe('legacy-test-key');
  });
  it('removes both old key aliases', async () => {
    window.miSecure = bridge('stored-test-key');
    const { useApiKey, apiKeyReady } = await import('./apiKey');
    await apiKeyReady;
    localStorage.setItem('mi.apiKey', 'old-test-key');
    await useApiKey.getState().clear();
    expect(useApiKey.getState().hasKey).toBe(false);
    expect(localStorage.getItem('mi.apiKey')).toBeNull();
    expect(window.miSecure.setApiKey).toHaveBeenCalledWith('');
  });
});
