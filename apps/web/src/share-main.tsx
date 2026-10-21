/**
 * Entry for the share viewer (share.html). The shared research reaches the page one of two ways: embedded in the
 * page itself (a share downloaded as a page and hosted anywhere), or, for a hosted link (share.html?s=<id>), fetched
 * by id from the share Worker. With neither (opened straight from the template) it says so instead of showing an
 * empty app.
 */
import './features/share/viewer/guard-first';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { ShareSnapshot } from '@mi/contracts';
import { ErrorBoundary } from '@/components/states/ErrorBoundary';
import { ShareApp } from '@/features/share/viewer/ShareApp';
import { readEmbeddedShare } from '@/features/share/viewer/embedded';
import { loadRemoteShare, shareIdFromSearch, type RemoteShareResult } from '@/features/share/viewer/remote';
import { shareMeta } from '@/lib/share/bundle';
import { SHARE_API_URL } from '@/lib/hostedApi';
import './index.css';

function Notice({ title, children, alert = false }: { title: string; children: React.ReactNode; alert?: boolean }) {
  return (
    <main role={alert ? 'alert' : 'status'} className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="font-display text-xl font-semibold text-content">{title}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">{children}</p>
    </main>
  );
}

function RemoteShare({ id }: { id: string }) {
  const [result, setResult] = useState<RemoteShareResult | null>(null);
  useEffect(() => {
    let live = true;
    void loadRemoteShare(id, SHARE_API_URL).then((r) => {
      if (!live) return;
      if (r.ok) document.title = shareMeta(r.snapshot).title;
      setResult(r);
    });
    return () => { live = false; };
  }, [id]);
  if (!result) return <Notice title="Opening the shared research">One moment.</Notice>;
  if (!result.ok) return <Notice title={result.reason === 'gone' ? 'This link is no longer available' : 'This could not be opened'} alert>{result.message}</Notice>;
  return <ShareApp snapshot={result.snapshot} />;
}

const embedded = readEmbeddedShare(document);
const remoteId = embedded.snapshot ? null : shareIdFromSearch(window.location.search);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="This shared page could not be opened">
      {embedded.snapshot ? (
        <ShareApp snapshot={embedded.snapshot as ShareSnapshot} signupUrl={embedded.signupUrl} />
      ) : remoteId ? (
        <RemoteShare id={remoteId} />
      ) : (
        <p role="alert" className="m-8 text-muted">This page has no shared research in it.</p>
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
