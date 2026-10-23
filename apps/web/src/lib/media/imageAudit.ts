/**
 * Image hit-rate telemetry (dev / opt-in only).
 *
 * Every place the app wants a real picture reports what happened to it:
 * `requested` when the slot starts looking, then `loaded` (a real picture is
 * showing) or `fallback` (the monogram / editorial art holds the frame). The
 * counts are kept per surface and per host in memory and exposed as
 * `window.__imgAudit`, which `scripts/image-audit.mjs` reads. Nothing is sent
 * anywhere and, unless the audit is switched on, every call is a no-op.
 *
 * On: Vite dev builds, or `localStorage['mi.imgAudit'] = '1'`, or
 * `window.__imgAuditOn = true` set before the app boots.
 */
export type ImageSurface =
  | 'logo'
  | 'signal-hero'
  | 'story'
  | 'overview-thumb'
  | 'product'
  | 'person'
  | 'site-shot'
  | 'report-cover';

export type ImageOutcome = 'requested' | 'loaded' | 'fallback';

export interface HostCounts { requested: number; loaded: number; fallback: number }
export type AuditSnapshot = Record<string, { total: HostCounts; hosts: Record<string, HostCounts> }>;

const zero = (): HostCounts => ({ requested: 0, loaded: 0, fallback: 0 });
const state: AuditSnapshot = {};

function enabled(): boolean {
  try {
    const w = globalThis as unknown as { __imgAuditOn?: boolean; localStorage?: Storage };
    if (w.__imgAuditOn) return true;
    if (w.localStorage?.getItem('mi.imgAudit') === '1') return true;
  } catch { /* storage blocked */ }
  try { return Boolean(import.meta.env?.DEV); } catch { return false; }
}

/** The host a picture came from, or a short tag when it has none (data: URLs, nothing). */
export function auditHost(src: string | null | undefined): string {
  if (!src) return 'none';
  if (src.startsWith('data:')) return 'data';
  try {
    const u = new URL(src, 'https://local.invalid');
    // Pictures shown through the hosted proxy are attributed to the real publisher host.
    const inner = /\/v1\/image$/.test(u.pathname) ? u.searchParams.get('url') : null;
    if (inner) return auditHost(inner);
    return u.hostname.replace(/^www\./, '');
  } catch { return 'invalid'; }
}

export function recordImage(surface: ImageSurface, outcome: ImageOutcome, src?: string | null): void {
  if (!enabled()) return;
  const s = (state[surface] ??= { total: zero(), hosts: {} });
  const h = (s.hosts[auditHost(src)] ??= zero());
  s.total[outcome] += 1;
  h[outcome] += 1;
  install();
}

export function auditSnapshot(): AuditSnapshot {
  return JSON.parse(JSON.stringify(state)) as AuditSnapshot;
}

export function resetImageAudit(): void {
  for (const k of Object.keys(state)) delete state[k];
}

/** loaded / (loaded + fallback); null when nothing has settled. Slots still loading do not count against it. */
export function hitRate(c: HostCounts): number | null {
  const settled = c.loaded + c.fallback;
  return settled === 0 ? null : c.loaded / settled;
}

function install(): void {
  const w = globalThis as unknown as { __imgAudit?: unknown };
  if (w.__imgAudit) return;
  w.__imgAudit = { snapshot: auditSnapshot, reset: resetImageAudit };
}
if (enabled()) install();
