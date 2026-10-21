/**
 * "Add a company from a link": paste a post, site or article, see which company
 * it is and where that came from, then choose what to do. Nothing is spent or
 * saved until the person confirms. The reader says "unidentified" rather than
 * guess, and then the person types the name.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LinkCandidate, LinkCandidateSource } from '@mi/contracts';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { useMarkets } from '@/hooks/data';
import { useAgentTrace } from '@/lib/agentic/agentTrace';
import { findSimilarMarket } from '@/features/markets/deck-library';

type Identified = Extract<LinkCandidate, { status: 'identified' }>;
type Step =
  | { kind: 'closed' }
  | { kind: 'input'; error?: string }
  | { kind: 'reading' }
  | { kind: 'confirm'; candidate: Pick<Identified, 'name' | 'websiteUrl' | 'descriptor' | 'sources'>; typed: boolean }
  | { kind: 'needName'; reason: string };

const HOW: Record<LinkCandidateSource['how'], string> = {
  link_address: 'the link itself',
  page: 'the page',
  pasted_text: 'the text you pasted',
  search: 'a web search',
};

/** Only web addresses become links. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

export function AddFromLink({ onStartDeck }: {
  /** Research the company in a new deck, and optionally put it on Today. */
  onStartDeck: (name: string, followAfter: boolean) => void;
}) {
  const repo = useRepository();
  const navigate = useNavigate();
  const supported = useSupports('identifyCompanyFromLink');
  const canFollow = useSupports('followCompanies');
  const markets = useMarkets();
  const enqueueHunt = useAgentTrace((s) => s.enqueueHunt);
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [typedName, setTypedName] = useState('');
  const [deckId, setDeckId] = useState('');
  const [today, setToday] = useState(false);
  if (!supported) return null;

  const decks = (markets.data ?? []).filter((m) => !m.archivedAt);
  const reset = () => { setStep({ kind: 'closed' }); setLink(''); setText(''); setTypedName(''); setDeckId(''); setToday(false); };

  const read = async (e: FormEvent) => {
    e.preventDefault();
    if (!link.trim() || step.kind === 'reading') return;
    setStep({ kind: 'reading' });
    try {
      const out = await repo.identifyCompanyFromLink!({ url: link.trim(), ...(text.trim() ? { text: text.trim() } : {}) });
      if (out.status === 'unidentified') {
        setStep({ kind: 'needName', reason: out.reason });
        return;
      }
      // An existing deck is suggested only when the company clearly belongs to it; it is never preselected otherwise.
      const fit = out.descriptor ? findSimilarMarket(out.descriptor, decks) : null;
      setDeckId(fit?.id ?? '');
      setStep({ kind: 'confirm', candidate: out, typed: false });
    } catch (err) {
      setStep({ kind: 'input', error: err instanceof Error ? err.message : 'Could not read that link.' });
    }
  };

  const useTypedName = (e: FormEvent) => {
    e.preventDefault();
    const name = typedName.trim();
    if (name.length < 2) return;
    setDeckId('');
    setStep({ kind: 'confirm', typed: true, candidate: { name, websiteUrl: null, descriptor: null, sources: [] } });
  };

  if (step.kind === 'closed') {
    return (
      <p className="mt-6 text-[13px] text-muted">
        Heard about a company?{' '}
        <button type="button" className="underline hover:text-content" onClick={() => setStep({ kind: 'input' })}>
          Add one from a link
        </button>
      </p>
    );
  }

  return (
    <section aria-label="Add a company from a link" className="mt-6 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-[14px] font-semibold text-content">Add a company from a link</h2>

      {(step.kind === 'input' || step.kind === 'reading') && (
        <form onSubmit={read} className="mt-3 space-y-2">
          <label className="label" htmlFor="capture-link">Link to a post, website or article</label>
          <input id="capture-link" className="input" value={link} onChange={(e) => setLink(e.target.value)}
            placeholder="https://x.com/…" disabled={step.kind === 'reading'} autoComplete="off" />
          <label className="label" htmlFor="capture-text">Text from the post (optional, helps with X links)</label>
          <textarea id="capture-text" className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)}
            disabled={step.kind === 'reading'} />
          {step.kind === 'input' && step.error && <p role="alert" className="text-[13px] text-negative">{step.error}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary" disabled={!link.trim() || step.kind === 'reading'}>
              {step.kind === 'reading' ? 'Reading the link…' : 'Find the company'}
            </button>
            <button type="button" className="text-[13px] text-muted hover:text-content" onClick={reset}>Cancel</button>
          </div>
          <p className="text-[12px] text-faint">Nothing is researched or saved until you confirm the company.</p>
        </form>
      )}

      {step.kind === 'needName' && (
        <form onSubmit={useTypedName} className="mt-3 space-y-2">
          <p role="status" className="text-[13px] text-content">{step.reason}</p>
          <label className="label" htmlFor="capture-name">Company name</label>
          <input id="capture-name" className="input" value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="off" />
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary" disabled={typedName.trim().length < 2}>Continue</button>
            <button type="button" className="text-[13px] text-muted hover:text-content" onClick={reset}>Cancel</button>
          </div>
        </form>
      )}

      {step.kind === 'confirm' && (() => {
        const { candidate } = step;
        const name = candidate.name;
        const focusCompany = { name, domain: candidate.websiteUrl, descriptor: candidate.descriptor };
        const fit = candidate.descriptor ? findSimilarMarket(candidate.descriptor, decks) : null;
        return (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[14px] text-content">
                <span className="font-semibold">{name}</span>{candidate.descriptor ? `, ${candidate.descriptor}` : ''}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                {candidate.sources.length === 0
                  ? 'Source: you typed this name.'
                  : candidate.sources.map((s, i) => {
                    const href = safeHref(s.url);
                    return (
                      <span key={`${s.how}-${i}`}>
                        {i > 0 ? ' · ' : 'Source: '}
                        {href ? <a className="underline" href={href} target="_blank" rel="noopener noreferrer">{s.title ?? new URL(href).hostname}</a> : (s.title ?? HOW[s.how])}
                        {` (${HOW[s.how]})`}
                      </span>
                    );
                  })}
              </p>
              {candidate.websiteUrl && <p className="text-[12px] text-faint">{candidate.websiteUrl.replace(/^https?:\/\//, '')}</p>}
            </div>

            {decks.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="capture-deck">Deck to add to</label>
                <select id="capture-deck" className="input w-auto max-w-[16rem]" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                  <option value="">Choose a deck…</option>
                  {decks.map((m) => <option key={m.id} value={m.id}>{m.name}{fit?.id === m.id ? ' (suggested)' : ''}</option>)}
                </select>
                <button type="button" className="btn-primary" disabled={!deckId}
                  onClick={() => {
                    enqueueHunt({ marketId: deckId, focus: { company: focusCompany }, label: `Add ${name}`, followAfter: today && canFollow });
                    navigate(`/markets/${deckId}/deck`);
                  }}>
                  Add to this deck
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-ghost" onClick={() => { onStartDeck(name, today && canFollow); reset(); }}>
                Start a new deck
              </button>
              <button type="button" className="text-[13px] text-muted hover:text-content" onClick={() => { setTypedName(''); setStep({ kind: 'needName', reason: 'Type the company you mean.' }); }}>
                Not this company
              </button>
            </div>

            {canFollow && (
              <label className="flex items-center gap-2 text-[13px] text-content">
                <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} />
                Also add it to Today
              </label>
            )}
          </div>
        );
      })()}
    </section>
  );
}
