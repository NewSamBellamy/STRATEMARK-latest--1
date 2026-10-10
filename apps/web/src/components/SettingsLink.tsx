import type { ReactNode } from 'react';
import { useSettingsModal, type SettingsTab } from '@/lib/settings/settingsModal';

/** Open settings without navigating away from an unfinished research prompt. */
export function SettingsLink({ children, className, tab }: { children: ReactNode; className?: string; tab?: SettingsTab }) {
  const open = useSettingsModal((state) => state.open);
  return <button type="button" className={className} onClick={() => open(tab)}>{children}</button>;
}
