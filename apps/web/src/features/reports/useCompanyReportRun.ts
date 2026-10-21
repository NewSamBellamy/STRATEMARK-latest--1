/**
 * Starts a company report in the background and reports the outcome through
 * the task manager, so the user can keep working and is told when it is ready.
 * The engine reports no stages over its transport, so the task shows activity
 * (indeterminate), never a made-up percentage.
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReportTopic } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useOptionalTaskManager } from '@/lib/tasks/TaskManagerContext';

export interface CompanyReportRequest {
  companyId: string;
  companyName: string;
  topics: ReportTopic[];
  focus: string | null;
}

export function useCompanyReportRun() {
  const repo = useRepository();
  const qc = useQueryClient();
  const tasks = useOptionalTaskManager();

  return useCallback(
    (request: CompanyReportRequest): Promise<string | null> => {
      // Where no task manager is mounted (tests, embeds) the report still runs; nobody is told.
      const taskId = tasks?.startTask('report', `Report: ${request.companyName}`, { indeterminate: true }) ?? null;
      if (taskId) tasks?.appendLog(taskId, 'Reading the research already stored', 'step');
      return repo
        .generateReport({ kind: 'company', subjectId: request.companyId, focus: request.focus, topics: request.topics })
        .then((report) => {
          void qc.invalidateQueries({ queryKey: ['reports'] });
          if (taskId) tasks?.completeTask(taskId, { message: 'Your report is ready.', link: `/reports/${report.id}` });
          return report.id;
        })
        .catch((error: unknown) => {
          if (taskId) tasks?.failTask(taskId, error instanceof Error ? error.message : 'The report could not be created.');
          return null;
        });
    },
    [repo, qc, tasks],
  );
}
