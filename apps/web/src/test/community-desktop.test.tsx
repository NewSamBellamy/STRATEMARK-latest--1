import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SettingsLink } from '@/components/SettingsLink';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { useEngineChoice } from '@/lib/settings/engine';
import { selectRepository } from '@/lib/repository/RepositoryProvider';
import { IpcRepository } from '@/lib/repository/ipc-repository';
import { MockRepository } from '@mi/mocks';
import type { PreloadRepositoryApi } from '@mi/contracts';

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.mi;
  window.history.replaceState({}, '', '/');
  useSettingsModal.setState({ isOpen: false });
  useEngineChoice.setState({ engine: 'local' });
});
describe('community desktop integration', () => {
  it('opens settings without navigating away from the current draft', async () => {
    render(
      <MemoryRouter initialEntries={['/markets/current/deck']}>
        <SettingsLink>Add key</SettingsLink>
      </MemoryRouter>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add key' }));
    expect(useSettingsModal.getState().isOpen).toBe(true);
  });
  it('ignores stale cloud engine preferences in a desktop build', () => {
    vi.stubEnv('VITE_DESKTOP', '1');
    useEngineChoice.getState().setEngine('cloud');
    expect(useEngineChoice.getState().engine).toBe('local');
  });
  it('always uses the native repository when the bridge is present', () => {
    window.mi = {} as PreloadRepositoryApi;
    expect(selectRepository('', '', 'cloud')).toBeInstanceOf(IpcRepository);
  });
  it('uses the bundled research in an explicit development preview even with a saved key', async () => {
    window.history.replaceState({}, '', '/?preview=demo');
    const repository = selectRepository('saved-provider-key', 'saved-model', 'cloud');
    expect(repository).toBeInstanceOf(MockRepository);
    expect((await repository.getMarket('mkt_frontier-ai-ecosystem_s248s'))?.name).toBe(
      'Frontier AI Ecosystem',
    );
  });
});
