/** True while the desktop exposes a passive, staged migration preview. */
export function isReadOnlyResearch(): boolean {
  return typeof window !== 'undefined' && window.mi?.storageMode === 'staged_readonly';
}

/** Desktop community builds never require a hosted account or service. */
export function isCommunityDesktop(): boolean {
  return import.meta.env.VITE_DESKTOP === '1' || (typeof window !== 'undefined' && !!window.mi);
}
