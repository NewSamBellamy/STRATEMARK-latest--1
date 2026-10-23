import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompanyReportResult } from '@mi/contracts';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';

/**
 * Under 'dashboard' + companyId so everything that already refreshes a company's dashboard (a chat answer, a dropped-in
 * document, a research pass) also re-reads this and re-checks whether the report is behind. Reading never calls a model.
 */
export const companyReportKey = (companyId: string) => ['dashboard', companyId, 'companyReport'] as const;

export function useCompanyReport(companyId: string) {
  const repo = useRepository();
  const supported = useSupports('peekCompanyReport');
  return {
    supported,
    ...useQuery({
      queryKey: companyReportKey(companyId),
      queryFn: () => repo.peekCompanyReport!(companyId),
      enabled: supported,
      staleTime: 15_000,
    }),
  };
}

/** Writes the report with one model call. Only ever started by a person pressing the button. */
export function useWriteCompanyReport(companyId: string) {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation<CompanyReportResult, Error, { force?: boolean } | void>({
    mutationFn: (options) => repo.getCompanyReport!(companyId, { force: Boolean(options && options.force) }),
    onSuccess: (result) => qc.setQueryData(companyReportKey(companyId), result),
  });
}
