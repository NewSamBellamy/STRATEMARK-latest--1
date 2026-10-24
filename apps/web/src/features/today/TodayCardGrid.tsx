import type { CompanyFollow } from '@mi/contracts';
import { GameCard } from '@/features/card/GameCard';
import { useCompanyCard } from '@/hooks/today';

interface TodayCardGridProps {
  follows: readonly CompanyFollow[];
  /** Unread moves per followed company. */
  unreadByCompany: ReadonlyMap<string, number>;
  onOpen: (companyId: string) => void;
}

/** The companies you follow, each as its card in the acrylic case. Opening one shows what changed for it today. */
export function TodayCardGrid({ follows, unreadByCompany, onOpen }: TodayCardGridProps) {
  return (
    <ul aria-label="Followed company cards" className="card-grid mb-6">
      {follows.map((follow) => (
        <li key={follow.companyId}>
          <TodayCardTile follow={follow} unread={unreadByCompany.get(follow.companyId) ?? 0} onOpen={() => onOpen(follow.companyId)} />
        </li>
      ))}
    </ul>
  );
}

function TodayCardTile({ follow, unread, onOpen }: { follow: CompanyFollow; unread: number; onOpen: () => void }) {
  const card = useCompanyCard(follow.companyId).data ?? null;
  const name = follow.companyName ?? follow.companyId;
  return (
    <div>
      {card ? (
        <GameCard data={card} skin="acrylic" hideActions onOpen={onOpen} />
      ) : (
        <button type="button" className="panel w-full p-5 text-left" onClick={onOpen}>
          <span className="font-display text-lg font-semibold text-content">{name}</span>
        </button>
      )}
      <p className="mt-2 text-center text-xs text-muted" aria-live="polite">
        {unread > 0 ? <span className="font-semibold text-primary">{unread} new {unread === 1 ? 'update' : 'updates'}</span> : 'All read'}
      </p>
    </div>
  );
}
