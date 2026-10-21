import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { getCostControls, isLowPower, recordCall, setCostControls } from '@/lib/usage';

const beta = vi.hoisted(() => ({ hosted: true }));
vi.mock('@/lib/beta', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isHostedBeta: () => beta.hosted,
}));

import { SettingsModal } from './SettingsModal';

const TABS = ['General', 'Engine', 'Data controls', 'Usage'];

function allText(): string {
  return document.body.textContent ?? '';
}

async function openTab(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name, 'i') }));
  await act(async () => { await Promise.resolve(); });
}

describe('Settings pricing wording', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsModal.setState({ isOpen: true, tab: null });
  });
  afterEach(() => useSettingsModal.setState({ isOpen: false, tab: null }));

  it('hosted beta: no dollars, free-tier, Free key or Paid key on any tab', async () => {
    beta.hosted = true;
    renderWithProviders(<SettingsModal />);
    for (const tab of TABS) {
      await openTab(tab);
      const text = allText();
      expect(text, tab).not.toMatch(/\$/);
      expect(text, tab).not.toMatch(/free-tier|free tier|free key|paid key|times faster/i);
    }
    await openTab('Usage');
    expect(screen.getByText('Low-power limit: requests per day')).toBeInTheDocument();
    await openTab('Engine');
    expect(allText()).toMatch(/beta engine is covered/i);
    expect(allText()).not.toMatch(/your connected Gemini API key/i);
  });

  it('not hosted: the existing wording is unchanged', async () => {
    beta.hosted = false;
    renderWithProviders(<SettingsModal />);
    expect(allText()).toMatch(/Free key \(slower/);
    expect(allText()).toMatch(/Paid key \(faster/);
    await openTab('Usage');
    expect(allText()).toMatch(/Monthly spending cap/);
    expect(allText()).toMatch(/free-tier requests/);
    expect(allText()).toMatch(/\$0\.00/);
  });

  it('the low-power limit round-trips and trips low power mode', async () => {
    beta.hosted = true;
    renderWithProviders(<SettingsModal />);
    await openTab('Usage');
    const input = screen.getByLabelText('Low-power limit: requests per day');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(getCostControls().dailyRequestLimit).toBe(2);
    expect(getCostControls().monthlyCapUsd).toBeNull();
    expect(isLowPower()).toBe(false);
    recordCall('ground');
    recordCall('structure');
    expect(isLowPower()).toBe(true);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(getCostControls().dailyRequestLimit).toBeNull();
    setCostControls({ dailyRequestLimit: 5 });
    await waitFor(() => expect((screen.getByLabelText('Low-power limit: requests per day') as HTMLInputElement).value).toBeDefined());
  });

  it('Data controls does not claim 0 decks when nothing is saved in the browser', async () => {
    beta.hosted = true;
    renderWithProviders(<SettingsModal />);
    await openTab('Data controls');
    await waitFor(() => expect(allText()).toMatch(/No saved copy in this browser yet/));
    expect(allText()).not.toMatch(/0 KB|0\s*decks stored/);
  });
});
