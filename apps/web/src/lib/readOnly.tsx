/**
 * Read-only mode: the viewer inside a share link. Screens that can research,
 * change or share check this and drop those controls, so a recipient sees the
 * research and nothing that pretends to do more than that.
 *
 * `tabs` lists, per company, the dashboard tabs that travelled with the share.
 * A tab that was never researched when it was shared is not offered, and says
 * so if opened by address.
 */
import { createContext, useContext, type ReactNode } from 'react';

interface ReadOnlyValue {
  readOnly: boolean;
  tabs: Readonly<Record<string, readonly string[]>> | null;
}

const ReadOnlyContext = createContext<ReadOnlyValue>({ readOnly: false, tabs: null });

export function ReadOnlyProvider({ children, tabs = null }: { children: ReactNode; tabs?: Readonly<Record<string, readonly string[]>> | null }) {
  return <ReadOnlyContext.Provider value={{ readOnly: true, tabs }}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext).readOnly;
}

/** The tabs that came with a shared company, or null outside a share (everything is offered). */
export function useAvailableTabs(companyId: string): readonly string[] | null {
  const { readOnly, tabs } = useContext(ReadOnlyContext);
  return readOnly && tabs ? (tabs[companyId] ?? []) : null;
}
