/**
 * Which "page" a pathname shows. The app shell keys its route boundary on this,
 * so leaving a page unmounts it — and every dialog, drawer and popover it owns —
 * in the same commit that starts the next page.
 *
 * Without the key, React keeps the previous page mounted (merely hidden) while
 * the next route's code chunk downloads, and anything it portalled to <body>
 * (Radix dialogs, popovers) stayed on screen over the new page; offline, for
 * as long as the connection was down. The same key resets page-local state
 * when one page is reused for a different subject (another company, deck or
 * report), so nothing keyed to the previous subject leaks into the next.
 *
 * Dashboard tabs of ONE company are the same page: switching tabs keeps the
 * header mounted (each tab's own content still unmounts with the tab).
 */
export function pageKey(pathname: string): string {
  const dashboard = /^\/company\/([^/]+)\/dashboard(?:\/|$)/.exec(pathname);
  if (dashboard) return `/company/${dashboard[1]}/dashboard`;
  return pathname.replace(/\/+$/, '') || '/';
}
