import type { ReactNode } from 'react';
import { useSettingsModal } from '@/lib/settings/settingsModal';

/** Open settings without navigating away from an unfinished research prompt. */
export function SettingsLink({ children, className }: { children: ReactNode; className?: string }) {
  const open = useSettingsModal((state) => state.open);
  return <button type="button" className={className} onClick={open}>{children}</button>;
}
