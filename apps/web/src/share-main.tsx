/**
 * Entry for the share viewer (share.html). Reads the snapshot embedded in the
 * page and mounts the read-only app. With no data in the page (opened straight
 * from the template) it says so instead of showing an empty app.
 */
import './features/share/viewer/guard-first';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { ShareSnapshot } from '@mi/contracts';
import { ErrorBoundary } from '@/components/states/ErrorBoundary';
import { ShareApp } from '@/features/share/viewer/ShareApp';
import { readEmbeddedShare } from '@/features/share/viewer/embedded';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const embedded = readEmbeddedShare(document);

root.render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="This shared page could not be opened">
      {embedded.snapshot ? (
        <ShareApp snapshot={embedded.snapshot as ShareSnapshot} signupUrl={embedded.signupUrl} />
      ) : (
        <p role="alert" className="m-8 text-muted">This page has no shared research in it.</p>
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
