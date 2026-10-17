/**
 * The Today button that sits next to a card's bookmark: add the company to
 * Today (its releases, news and social sentiment, dated and sourced) or take it
 * off again. Only company cards get it, and only where the engine has Today.
 */
import { Sun } from 'lucide-react';
import { useSupports } from '@/lib/repository/RepositoryProvider';
import { useFollowCompanies, useFollows, useUnfollowCompany } from '@/hooks/today';

export function FollowTodayButton({ companyId, companyName }: { companyId: string | null | undefined; companyName: string }) {
  const supported = useSupports('followCompanies');
  const follows = useFollows();
  const follow = useFollowCompanies();
  const unfollow = useUnfollowCompany();
  if (!supported || !companyId) return null;
  const following = (follows.data ?? []).some((f) => f.companyId === companyId);
  const pending = follow.isPending || unfollow.isPending;
  return (
    <button
      type="button"
      className="card-control"
      aria-label={following ? `Following ${companyName} on Today. Press to stop.` : `Add ${companyName} to Today`}
      aria-pressed={following}
      title={following ? 'On Today: its releases, news and social sentiment. Press to stop following.' : 'Add to Today: its releases, news and social sentiment, dated and sourced.'}
      disabled={pending || follows.isLoading}
      onClick={() => (following ? unfollow.mutate(companyId) : follow.mutate([companyId]))}
    >
      <Sun size={15} fill={following ? 'currentColor' : 'none'} />
    </button>
  );
}
