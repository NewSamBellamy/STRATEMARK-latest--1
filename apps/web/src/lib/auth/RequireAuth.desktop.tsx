import type { ReactNode } from 'react';

export function RequireAuth({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
