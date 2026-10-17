/** Desktop community builds never require a hosted account or service. */
export function isCommunityDesktop(): boolean {
  return import.meta.env.VITE_DESKTOP === '1' ||
    (typeof window !== 'undefined' && !!window.mi);
}
