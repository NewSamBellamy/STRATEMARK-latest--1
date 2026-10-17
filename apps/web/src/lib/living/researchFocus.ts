import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * The company the person is looking at right now. Research for it goes first:
 * the deck's background prefetch for OTHER companies waits while a dashboard is
 * open, so the shared model quota serves what is on screen.
 */
export const useResearchFocus = create<{ companyId: string | null }>(() => ({ companyId: null }));

export function useFocusCompany(companyId: string | undefined): void {
  useEffect(() => {
    if (!companyId) return;
    useResearchFocus.setState({ companyId });
    return () => {
      if (useResearchFocus.getState().companyId === companyId) useResearchFocus.setState({ companyId: null });
    };
  }, [companyId]);
}

/** True when background work for `companyId` should yield to the focused company. */
export function yieldsToFocus(companyId: string): boolean {
  const focus = useResearchFocus.getState().companyId;
  return focus !== null && focus !== companyId;
}
