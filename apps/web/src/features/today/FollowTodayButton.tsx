/**
 * The Today button that sits next to a card's bookmark: add the company to
 * Today (its releases, news and social sentiment, dated and sourced) or take it
 * off again. Only company cards get it, and only where the engine has Today.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Sun } from 'lucide-react';
import { useSupports } from '@/lib/repository/RepositoryProvider';
import { useFollowCompanies, useFollows, useUnfollowCompany } from '@/hooks/today';

const CONFIRM_MS = 6_000;

/** One line after following: what happened, and the way to where it shows. Rendered in the page's corner so the card is untouched. */
function FollowedNotice({ companyName, onDone }: { companyName: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return createPortal(
    <div role="status" className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 px-4">
      <p className="pointer-events-auto rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[13px] text-content shadow-card">
        Following {companyName}.{' '}
        <Link to="/today" onClick={onDone} className="font-medium text-primary-ink hover:underline">See it on Today</Link>
      </p>
    </div>,
    document.body,
  );
}

export function FollowTodayButton({ companyId, companyName }: { companyId: string | null | undefined; companyName: string }) {
  const supported = useSupports('followCompanies');
  const follows = useFollows();
  const follow = useFollowCompanies();
  const unfollow = useUnfollowCompany();
  const [justFollowed, setJustFollowed] = useState(false);
  if (!supported || !companyId) return null;
  const following = (follows.data ?? []).some((f) => f.companyId === companyId);
  const pending = follow.isPending || unfollow.isPending;
  const toggle = () => {
    if (following) { setJustFollowed(false); unfollow.mutate(companyId); return; }
    follow.mutate([companyId], { onSuccess: () => setJustFollowed(true) });
  };
  return (
    <>
    <button
      type="button"
      className="card-control"
      aria-label={following ? `Following ${companyName} on Today. Press to stop.` : `Add ${companyName} to Today`}
      aria-pressed={following}
      title={following ? 'On Today: its releases, news and social sentiment. Press to stop following.' : 'Add to Today: Today checks it when you open it and lists what it did, dated and sourced.'}
      disabled={pending || follows.isLoading}
      onClick={toggle}
    >
      <Sun size={15} fill={following ? 'currentColor' : 'none'} />
    </button>
    {justFollowed && <FollowedNotice companyName={companyName} onDone={() => setJustFollowed(false)} />}
    </>
  );
}
