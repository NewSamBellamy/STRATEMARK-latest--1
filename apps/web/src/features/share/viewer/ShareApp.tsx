/**
 * The page a share link opens: Stratemark's own card, deck and company
 * dashboard screens, run read-only from the snapshot that travels inside the
 * page. No account, no keys, no research, and no calls to any Stratemark
 * service: the repository behind it is the snapshot and nothing else.
 */
import { Suspense, useMemo, type ReactNode } from 'react';
import { HashRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ShareSnapshot } from '@mi/contracts';
import { createShareRepository } from '@mi/mocks';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { DeepDiveProvider } from '@/features/deepdive/DeepDive';
import { createQueryClient } from '@/lib/query/queryClient';
import { ReadOnlyProvider } from '@/lib/readOnly';
import { lazyRoute } from '@/lib/lazyRoute';
import logoMark from '@/assets/logo-mark.svg';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { ShareHome } from './ShareHome';

const DeckPage = lazyRoute(() => import('@/features/deck/DeckPage'));
const DashboardPage = lazyRoute(() => import('@/features/dashboard/DashboardPage'));

/** Where "Sign up" goes. Set at build time; the page builder can override it per share. */
export const DEFAULT_SIGNUP_URL = 'https://getstratemark.com';

function Mark() {
  return <img src={logoMark} alt="" className="h-6 w-6" />;
}

function SignUpLine({ url, className = '' }: { url: string; className?: string }) {
  return (
    <p className={`text-[12.5px] text-muted ${className}`}>
      Want to research more companies?{' '}
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-ink underline-offset-2 hover:underline">
        Sign up
      </a>
    </p>
  );
}

function ShareShell({ signupUrl, title }: { signupUrl: string; title: string }) {
  return (
    <div className="min-h-screen bg-app text-content">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label="Back to the start of this share">
            <Mark />
            <span className="font-display text-[15px] font-semibold tracking-tight">Stratemark</span>
            <span className="hidden truncate text-[12px] text-faint sm:inline">Shared research · {title}</span>
          </Link>
          <a
            href={signupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content hover:bg-surface-2"
          >
            Sign up
          </a>
        </div>
      </header>
      <main className="px-4 py-5 sm:px-6 sm:py-6">
        <Suspense fallback={<FullPageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="border-t border-border px-4 py-6 text-center sm:px-6">
        <SignUpLine url={signupUrl} />
        <p className="mt-1 text-[11.5px] text-faint">A read-only copy. Every figure keeps its source; nothing here runs new research.</p>
      </footer>
    </div>
  );
}

function Providers({ snapshot, children }: { snapshot: ShareSnapshot; children: ReactNode }) {
  const repository = useMemo(() => createShareRepository(snapshot), [snapshot]);
  const queryClient = useMemo(() => createQueryClient(), []);
  return (
    <ReadOnlyProvider tabs={Object.fromEntries(Object.entries(snapshot.dashboards).map(([id, tabs]) => [id, Object.keys(tabs)]))}>
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={queryClient}>
          <DeepDiveProvider>{children}</DeepDiveProvider>
        </QueryClientProvider>
      </RepositoryProvider>
    </ReadOnlyProvider>
  );
}

export function ShareApp({ snapshot, signupUrl = DEFAULT_SIGNUP_URL }: { snapshot: ShareSnapshot; signupUrl?: string }) {
  const title = snapshot.kind === 'card'
    ? (snapshot.companies[0]?.name ?? snapshot.cards[0]?.title ?? 'Card')
    : (snapshot.markets[0]?.name ?? 'Deck');
  return (
    <Providers snapshot={snapshot}>
      <HashRouter>
        <Routes>
          <Route element={<ShareShell signupUrl={signupUrl} title={title} />}>
            <Route index element={<ShareHome snapshot={snapshot} />} />
            <Route path="markets/:marketId/deck" element={<DeckPage />} />
            <Route path="company/:companyId/dashboard" element={<Navigate to="overview" replace />} />
            <Route path="company/:companyId/dashboard/:tab" element={<DashboardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </Providers>
  );
}
