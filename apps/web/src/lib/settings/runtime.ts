/** True while the desktop exposes a passive, staged migration preview. */
export function isReadOnlyResearch(): boolean {
  return typeof window !== 'undefined' && window.mi?.storageMode === 'staged_readonly';
}

/** Explicit local development handoff: bundled data only, never a provider-backed repository. */
export function isDemoPreview(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('preview') === 'demo'
  );
}

/** Desktop community builds never require a hosted account or service. */
export function isCommunityDesktop(): boolean {
  return import.meta.env.VITE_DESKTOP === '1' || (typeof window !== 'undefined' && !!window.mi);
}
