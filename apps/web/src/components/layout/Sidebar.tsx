import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  BookmarkSimple,
  CaretLeft,
  CaretRight,
  ClockCounterClockwise,
  FileText,
  Gear,
  PlusCircle,
} from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { useApiKey } from '@/lib/settings/apiKey';
import { useMarkets } from '@/hooks/data';
import { useResearchSession } from '@/features/deck/research-session';
import wordmark from '@/assets/wordmark.svg';
import { useSettingsModal } from '@/lib/settings/settingsModal';

export function SettingsTrigger({ collapsed }: { collapsed: boolean }) {
  const { open } = useSettingsModal();
  return (
    <button
      type="button"
      onClick={open}
      title={collapsed ? "Settings" : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg transition-colors text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-content',
        collapsed ? 'justify-center px-0 py-2.5 w-full' : 'px-3 py-2 w-full text-left'
      )}
    >
      <Gear weight="duotone" size={collapsed ? 22 : 20} />
      {!collapsed && "Settings"}
    </button>
  );
}

export function Sidebar() {
  const hasKey = useApiKey((s) => s.hasKey);
  const [collapsed, setCollapsed] = useState(false);
  const markets = useMarkets();
  // A deck being researched RIGHT NOW belongs in this list already —
  // "I started it, where is it?" should never have an empty answer.
  const session = useResearchSession((s) => s.session);
  const researching = session?.running ? session.query : null;

  // Most-recent decks first — the sidebar becomes the deck history itself.
  const recentDecks = useMemo(() => {
    const list = markets.data ?? [];
    return [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [markets.data]);

  return (
    <aside className={cn(
      'flex h-full shrink-0 flex-col border-r border-border bg-surface py-6 transition-all duration-200',
      collapsed ? 'w-16 px-2' : 'w-56 px-4',
    )}>
      {/* Logo + collapse toggle */}
      <div className={cn('mb-6 flex items-center', collapsed ? 'flex-col gap-2' : 'justify-between px-2')}>
        {collapsed ? (
          <img src={wordmark} alt="Stratemark" className="h-8 w-8" />
        ) : (
          <div className="flex items-center gap-2">
            <img src={wordmark} alt="" className="h-7 w-7" />
            <span className="font-display text-[15px] font-bold tracking-tight text-content">Stratemark</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-content"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <CaretRight size={14} /> : <CaretLeft size={14} />}
        </button>
      </div>

      {/* Primary Navigation */}
      <nav className="flex shrink-0 flex-col gap-0.5" aria-label="Primary">
        <SidebarLink to="/" end icon={PlusCircle} label="New Deck" collapsed={collapsed} primary />
        {/* Collapsed: no room for the inline list, so keep a link to the full history page. */}
        {collapsed && (
          <SidebarLink to="/history" icon={ClockCounterClockwise} label="Deck History" collapsed />
        )}
        <SidebarLink to="/saved" icon={BookmarkSimple} label="Saved Cards" collapsed={collapsed} />
        <SidebarLink to="/reports" icon={FileText} label="Reports" collapsed={collapsed} />
        <SettingsTrigger collapsed={collapsed} />
      </nav>

      {/* Recent decks — inline history (expanded only) */}
      {!collapsed && (
        <div className="mt-6 flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="text-[10px] font-medium text-faint">Recent Decks</p>
            {recentDecks.length > 0 && (
              <NavLink to="/history" className="text-[10px] font-medium text-faint transition-colors hover:text-content">
                View all
              </NavLink>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {markets.isLoading ? (
              <p className="px-3 py-1 text-[12px] text-faint">Loading…</p>
            ) : recentDecks.length === 0 && !researching ? (
              <p className="px-3 py-1 text-[12px] leading-snug text-faint">
                No decks yet. Start one above.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {researching && (
                  <li>
                    <NavLink
                      to="/"
                      title={`Researching now: ${researching}`}
                      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-content"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                      <span className="min-w-0 flex-1 truncate italic">{researching}</span>
                    </NavLink>
                  </li>
                )}
                {recentDecks.map((m) => {
                  const isRunning = (m as { status?: string }).status === 'running';
                  return (
                    <li key={m.id}>
                      <NavLink
                        to={`/markets/${m.id}/deck`}
                        title={isRunning ? `Researching: ${m.name}` : m.name}
                        className={({ isActive }) => cn(
                          'flex items-center justify-between truncate rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                          isActive
                            ? 'bg-primary/8 font-medium text-primary'
                            : 'text-muted hover:bg-surface-2 hover:text-content',
                        )}
                      >
                        <span className="truncate">{m.name}</span>
                        {isRunning && (
                          <span
                            className="ml-1.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary"
                            title="Research in progress"
                          />
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      {collapsed && <div className="flex-1" />}

      {(!hasKey) && (
        <div className="shrink-0 px-2 pt-4">
          {!collapsed ? (
            <NavLink
              to="/settings"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-content"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-neutral" />
              Add your API key
            </NavLink>
          ) : (
            <div className="flex justify-center">
              <span className="h-2 w-2 rounded-full bg-neutral" />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function SidebarLink({
  to, end, icon: Icon, label, collapsed, primary,
}: {
  to: string; end?: boolean; icon: React.ElementType;
  label: string; collapsed: boolean; primary?: boolean;
}) {
  return (
    <NavLink
      to={to} end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) => cn(
        'flex items-center gap-3 rounded-lg transition-colors',
        collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2',
        'text-[13px]',
        isActive
          ? 'bg-primary/8 font-semibold text-primary'
          : primary
            ? 'font-medium text-content hover:bg-surface-2'
            : 'font-medium text-muted hover:bg-surface-2 hover:text-content',
      )}
    >
      {({ isActive }) => (
        <>
          <Icon weight="duotone" size={collapsed ? 22 : 20} className={isActive ? 'text-primary' : ''} />
          {!collapsed && label}
        </>
      )}
    </NavLink>
  );
}
