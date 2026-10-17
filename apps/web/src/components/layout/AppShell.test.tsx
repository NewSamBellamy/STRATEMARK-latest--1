import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/test-utils';
import { AppShell } from './AppShell';

function renderShell() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<p>Home</p>} />
      </Route>
    </Routes>,
  );
}

describe('AppShell phone drawer', () => {
  // jsdom applies no media queries, so the desktop sidebar is always present;
  // the drawer is the SECOND primary nav.
  const drawerNav = () => screen.queryAllByRole('navigation', { name: 'Primary' })[1] ?? null;

  it('moves focus into the drawer on open and returns it to the menu button on Escape', async () => {
    const { user } = renderShell();
    const menu = screen.getByRole('button', { name: 'Toggle menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(drawerNav()).not.toBeNull());
    const drawer = drawerNav()!.closest('aside')!;
    await waitFor(() => expect(drawer).toContainElement(document.activeElement as HTMLElement));

    await user.keyboard('{Escape}');
    expect(drawerNav()).toBeNull();
    expect(menu).toHaveFocus();
  });
});
