/**
 * Web-search provider key (bring your own: Tavily, Serper, Exa, Jina, Brave).
 *
 * Like the Gemini key it lives only in this browser's localStorage. It is sent
 * only to Stratemark's search relay (the local dev bridge or the hosted
 * Worker), which forwards it to the chosen provider for that one request and
 * never stores or logs it. The provider APIs cannot all be called from a page
 * directly (CORS), which is why a relay exists at all.
 *
 * No key: a hosted build searches on Stratemark's own allowance; otherwise the
 * hunt keeps using model-grounded search exactly as before.
 */
import { create } from 'zustand';
import { isSearchProvider, relayWebSearch, type SearchProvider, type WebSearchFn } from '@mi/research';
import { hasHostedApi } from '@/lib/hostedApi';
import { hasLocalSourceBridge, relayEndpoint } from '@/lib/repository/local-source-reader';
import { sanitizeApiKey } from './apiKey';

const PROVIDER_KEY = 'mi.searchProvider';
const SEARCH_KEY = 'mi.searchKey';

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode — the key simply won't persist */
  }
}

interface SearchKeyState {
  provider: SearchProvider;
  key: string;
  setSearchKey: (provider: SearchProvider, key: string) => void;
  clear: () => void;
}

const storedProvider = read(PROVIDER_KEY);

export const useSearchKey = create<SearchKeyState>((set) => ({
  provider: isSearchProvider(storedProvider) ? storedProvider : 'tavily',
  key: read(SEARCH_KEY),
  setSearchKey: (provider, key) => {
    const clean = sanitizeApiKey(key);
    write(PROVIDER_KEY, provider);
    write(SEARCH_KEY, clean);
    set({ provider, key: clean });
  },
  clear: () => {
    write(SEARCH_KEY, '');
    set({ key: '' });
  },
}));

const USAGE_KEY = 'mi.searchUsage';
/** Safely under the smallest common free tier (Tavily: 1,000/month). */
export const SEARCH_MONTHLY_CAP = 900;

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Searches sent on the user's own key this calendar month. */
export function searchUsageThisMonth(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(USAGE_KEY) ?? 'null') as { month?: unknown; count?: unknown } | null;
    return saved?.month === thisMonth() && typeof saved.count === 'number' ? saved.count : 0;
  } catch {
    return 0;
  }
}

/** Reserve one search under the monthly cap; false when the cap is reached. */
export function spendSearch(cap = SEARCH_MONTHLY_CAP): boolean {
  const used = searchUsageThisMonth();
  if (used >= cap) return false;
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify({ month: thisMonth(), count: used + 1 }));
  } catch {
    /* storage unavailable: still bounded per session by the hunt's own limits */
  }
  return true;
}

const searchEndpoint = () => relayEndpoint('search');

/** Keyless searches go to the hosted allowance (production build with the Worker). */
export function hostedSearchAvailable(): boolean {
  return !hasLocalSourceBridge() && hasHostedApi();
}

/** Whether this build can use a search key at all (needs a relay). */
export function canUseSearchKey(): boolean {
  return searchEndpoint() !== null;
}

/** One real query through the relay with a draft key; resolves to the result count. */
export async function testSearchKey(provider: SearchProvider, key: string): Promise<number> {
  const endpoint = searchEndpoint();
  if (!endpoint) throw new Error('Web search needs the Stratemark relay, which this build does not have.');
  const search = relayWebSearch({ endpoint: endpoint.url, headers: endpoint.headers, provider, key: sanitizeApiKey(key) });
  return (await search('Stratemark market intelligence')).length;
}

/**
 * The hunt's search function for right now: the user's own key when set, the
 * hosted allowance (Serper) on a hosted build, otherwise null (grounded search).
 * Read per hunt, so a key added in Settings applies without a reload.
 */
export function currentWebSearch(): WebSearchFn | null {
  const endpoint = searchEndpoint();
  if (!endpoint) return null;
  const { provider, key } = useSearchKey.getState();
  if (key) {
    const search = relayWebSearch({ endpoint: endpoint.url, headers: endpoint.headers, provider, key });
    // The user's own free allowance: count every request this month and stop
    // at the cap, so research falls back to grounded search instead of
    // exhausting their key (or running up a bill).
    return async (query, options) => {
      if (!spendSearch()) return [];
      return search(query, options);
    };
  }
  if (hostedSearchAvailable()) return relayWebSearch({ endpoint: endpoint.url, headers: endpoint.headers, provider: 'serper' });
  return null;
}
