/**
 * Web search key (optional). A real search engine finds where figures are
 * published; the deck then reads those pages itself. Without a key, research
 * keeps using Gemini's built-in search (or the hosted allowance).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Search, Trash2 } from 'lucide-react';
import { SEARCH_PROVIDER_INFO, type SearchProvider } from '@mi/research';
import { sanitizeApiKey } from '@/lib/settings/apiKey';
import {
  canUseSearchKey,
  hostedSearchAvailable,
  SEARCH_MONTHLY_CAP,
  searchUsageThisMonth,
  testSearchKey,
  useSearchKey,
} from '@/lib/settings/searchKey';
import { cn } from '@/lib/cn';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; detail?: string };

export function WebSearchPanel() {
  const { provider: savedProvider, key: savedKey, setSearchKey, clear } = useSearchKey();
  const [provider, setProvider] = useState<SearchProvider>(savedProvider);
  const [draft, setDraft] = useState(savedKey);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(savedKey); }, [savedKey]);
  if (!canUseSearchKey()) return null;

  const info = SEARCH_PROVIDER_INFO.find((p) => p.id === provider) ?? SEARCH_PROVIDER_INFO[0]!;
  const connected = Boolean(savedKey);

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      const count = await testSearchKey(provider, draft);
      setTest({ status: count > 0 ? 'ok' : 'fail', detail: count > 0 ? `${info.name} returned ${count} results.` : `${info.name} answered but returned no results.` });
    } catch (error) {
      setTest({ status: 'fail', detail: error instanceof Error ? error.message.slice(0, 200) : 'Search test failed.' });
    }
  };

  return (
    <div className="border-t border-border pt-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-lg text-content">Web search</h2>
        <span className="chip border-border bg-surface text-muted">Optional</span>
        {connected && (
          <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        A search key lets research find more published figures, faster. Every figure is still read from the original page before it lands on a card.
        {!connected && (hostedSearchAvailable() ?' Without one, research uses Stratemark’s shared search allowance.' : ' Without one, research uses Gemini’s built-in search.')}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Search provider">
        {SEARCH_PROVIDER_INFO.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={provider === p.id}
            onClick={() => { setProvider(p.id); setTest({ status: 'idle' }); setSaved(false); }}
            className={cn(
              'flex flex-col items-start rounded-xl border p-3 text-left transition-all',
              provider === p.id ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/40' : 'border-border bg-surface-2 hover:border-border-strong',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-content">
              <Search className="h-3.5 w-3.5 text-muted" />
              {p.name}
              {i === 0 && <span className="chip border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-700">Recommended</span>}
            </span>
            <span className="mt-1 text-xs text-muted">{p.freeTier}{p.noCard ? ' · no card needed' : ''}</span>
          </button>
        ))}
      </div>

      <label className="label mt-4" htmlFor="search-key">{info.name} key</label>
      <input
        id="search-key"
        type="password"
        className="input w-full font-mono"
        placeholder={info.keyPrefix ? `${info.keyPrefix}…` : 'Paste your key'}
        value={draft}
        onChange={(e) => { setDraft(sanitizeApiKey(e.target.value)); setSaved(false); }}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="mt-2 text-xs text-muted">
        Get a free key at{' '}
        <a href={info.signupUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-ink hover:underline">
          {info.signupUrl.replace(/^https:\/\//, '')} <ExternalLink className="h-3 w-3" />
        </a>
        . Saved in this browser and passed through Stratemark’s relay to {info.name} only; never stored on our servers.
        {info.note ? ` ${info.note}` : ''}
      </p>

      {test.status !== 'idle' && (
        <div
          role="status"
          className={cn('mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
            test.status === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : test.status === 'fail' ? 'border-negative/40 bg-red-50 text-red-800'
                : 'border-border bg-surface-2 text-muted')}
        >
          {test.status === 'testing' && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
          {test.status === 'ok' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {test.status === 'fail' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {test.status === 'testing' && `Running one test search on ${info.name}…`}
            {test.status === 'ok' && <><strong>Key works.</strong> {test.detail}</>}
            {test.status === 'fail' && <><strong>Key test failed.</strong> {test.detail}</>}
          </span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={!draft.trim()}
          onClick={() => { setSearchKey(provider, draft); setSaved(true); }}>
          {saved ? 'Saved ✓' : 'Save search key'}
        </button>
        <button type="button" className="btn-ghost" disabled={!draft.trim() || test.status === 'testing'} onClick={() => void runTest()}>
          {test.status === 'testing' ? 'Testing…' : 'Test key'}
        </button>
        {connected && (
          <button type="button" className="btn-ghost text-negative" onClick={() => { clear(); setDraft(''); setSaved(false); setTest({ status: 'idle' }); }}>
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        )}
      </div>
      {connected && (
        <p className="mt-3 text-xs text-muted">
          {searchUsageThisMonth()} of {SEARCH_MONTHLY_CAP} searches used this month. At the limit, research switches back to Gemini’s built-in search until next month.
        </p>
      )}
    </div>
  );
}
