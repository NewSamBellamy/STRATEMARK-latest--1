import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { LogLine } from '@/features/deck/ResearchStage';

export interface RunningTask {
  id: string;
  type: 'deck_create' | 'deck_refresh' | 'report' | 'export' | 'import';
  title: string;
  marketId?: string;
  deckId?: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  currentStep: string;
  log: LogLine[];
  error?: string;
  startedAt: number;
  finishedAt?: number;
  /** Where "Open" goes when the task is done (a finished report, for example). */
  link?: string;
  /** Progress is not measurable (the engine reports no stages): show activity, not a percentage. */
  indeterminate?: boolean;
}

interface TaskManagerContextType {
  tasks: RunningTask[];
  activeTasks: RunningTask[];
  activeCount: number;
  startTask: (
    type: RunningTask['type'],
    title: string,
    meta?: { marketId?: string; deckId?: string; indeterminate?: boolean },
  ) => string;
  appendLog: (
    taskId: string,
    message: string,
    kind?: 'step' | 'find' | 'warn',
    progress?: number,
  ) => void;
  completeTask: (
    taskId: string,
    meta?: { marketId?: string; deckId?: string; message?: string; link?: string },
  ) => void;
  failTask: (taskId: string, error: string) => void;
  dismissTask: (taskId: string) => void;
  clearCompleted: () => void;
  getTask: (taskId: string) => RunningTask | undefined;
}

const TaskManagerContext = createContext<TaskManagerContextType | null>(null);

let taskCounter = 0;

export function TaskManagerProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<RunningTask[]>([]);

  const startTask = useCallback(
    (
      type: RunningTask['type'],
      title: string,
      meta?: { marketId?: string; deckId?: string; indeterminate?: boolean },
    ): string => {
      taskCounter += 1;
      const id = `task_${Date.now()}_${taskCounter}`;
      const now = Date.now();
      const newTask: RunningTask = {
        id,
        type,
        title,
        marketId: meta?.marketId,
        deckId: meta?.deckId,
        status: 'running',
        progress: 0.05,
        currentStep: 'Starting task…',
        log: [{ message: `Started: ${title}`, kind: 'step', at: now }],
        startedAt: now,
        ...(meta?.indeterminate ? { indeterminate: true } : {}),
      };
      setTasks((prev) => [newTask, ...prev]);
      return id;
    },
    [],
  );

  const appendLog = useCallback(
    (
      taskId: string,
      message: string,
      kind: 'step' | 'find' | 'warn' = 'step',
      progress?: number,
    ) => {
      const now = Date.now();
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const nextPct = progress != null ? Math.min(1, Math.max(t.progress, progress)) : t.progress;
          return {
            ...t,
            progress: nextPct,
            currentStep: message,
            log: [...t.log, { message, kind, at: now }],
          };
        }),
      );
    },
    [],
  );

  const completeTask = useCallback(
    (taskId: string, meta?: { marketId?: string; deckId?: string; message?: string; link?: string }) => {
      const now = Date.now();
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const finalMsg = meta?.message ?? 'Task completed successfully.';
          return {
            ...t,
            status: 'completed',
            progress: 1,
            currentStep: finalMsg,
            marketId: meta?.marketId ?? t.marketId,
            deckId: meta?.deckId ?? t.deckId,
            link: meta?.link ?? t.link,
            log: [...t.log, { message: finalMsg, kind: 'find', at: now }],
            finishedAt: now,
          };
        }),
      );
    },
    [],
  );

  const failTask = useCallback((taskId: string, error: string) => {
    const now = Date.now();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          status: 'failed',
          error,
          currentStep: `Failed: ${error}`,
          log: [...t.log, { message: `Error: ${error}`, kind: 'warn', at: now }],
          finishedAt: now,
        };
      }),
    );
  }, []);

  const dismissTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === 'running'));
  }, []);

  const getTask = useCallback((taskId: string) => tasks.find((t) => t.id === taskId), [tasks]);

  const activeTasks = tasks.filter((t) => t.status === 'running');

  return (
    <TaskManagerContext.Provider
      value={{
        tasks,
        activeTasks,
        activeCount: activeTasks.length,
        startTask,
        appendLog,
        completeTask,
        failTask,
        dismissTask,
        clearCompleted,
        getTask,
      }}
    >
      {children}
    </TaskManagerContext.Provider>
  );
}

/** For surfaces that should simply do nothing where no task manager is mounted (tests, embeds). */
export function useOptionalTaskManager(): TaskManagerContextType | null {
  return useContext(TaskManagerContext);
}

export function useTaskManager(): TaskManagerContextType {
  const ctx = useContext(TaskManagerContext);
  if (!ctx) throw new Error('useTaskManager must be used within a TaskManagerProvider');
  return ctx;
}
