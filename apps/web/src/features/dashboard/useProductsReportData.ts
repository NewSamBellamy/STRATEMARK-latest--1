/**
 * What the Products & Roadmap tab knows beyond the lineup itself: the stored
 * product briefs (read-only peeks, never research), the company's stored news
 * stories, and the bounded "Research top products" action.
 */
import { useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import type { LiveIntelItem, Product, ProductBrief } from '@mi/contracts';
import { useStoredLiveIntel } from '@/hooks/today';
import { qk } from '@/lib/query/keys';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { productKey, topToResearch } from './productsReport';

/** Briefs are peeked for this many products at most (a peek is free and local; a long lineup is a table). */
export const PEEK_LIMIT = 24;

export interface ProductsReportData {
  briefs: ReadonlyMap<string, ProductBrief>;
  intel: readonly LiveIntelItem[];
  canResearch: boolean;
  /** "Research top products": at most the first few without a brief, one after another. */
  bulk: { run: () => void; pending: boolean; progress: { done: number; total: number } | null; failed: number; remaining: number };
}

export function useProductsReportData(companyId: string, products: readonly Product[]): ProductsReportData {
  const repo = useRepository();
  const qc = useQueryClient();
  const canResearch = useSupports('researchProductBrief');
  const intel = useStoredLiveIntel(companyId).data?.items ?? [];
  const peeked = products.slice(0, PEEK_LIMIT);
  const results = useQueries({
    queries: peeked.map((p) => ({
      queryKey: qk.productBrief(companyId, p.name),
      queryFn: async () => (await repo.peekProductBrief?.(companyId, p.name)) ?? null,
      staleTime: 30_000,
    })),
  });
  const briefs = new Map<string, ProductBrief>();
  peeked.forEach((p, i) => { const b = results[i]?.data; if (b) briefs.set(productKey(p.name), b); });

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(0);
  const remaining = topToResearch(products, briefs).length;
  const mutation = useMutation({
    mutationFn: async (targets: Product[]) => {
      let bad = 0;
      setFailed(0);
      setProgress({ done: 0, total: targets.length });
      for (const [i, p] of targets.entries()) {
        try {
          const brief = await repo.researchProductBrief!({ companyId, productName: p.name, force: false });
          qc.setQueryData(qk.productBrief(companyId, p.name), brief);
        } catch { bad += 1; }
        setProgress({ done: i + 1, total: targets.length });
      }
      setFailed(bad);
    },
    onSettled: () => setProgress(null),
  });
  return {
    briefs, intel, canResearch,
    bulk: { run: () => mutation.mutate(topToResearch(products, briefs)), pending: mutation.isPending, progress, failed, remaining },
  };
}
