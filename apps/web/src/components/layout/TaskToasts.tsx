/**
 * Background work, in the corner of the screen: a quiet card while a report is
 * being built, and a notice with "Open report" when it finishes or fails. It
 * only speaks for work that started while the app is open (tasks are session
 * state), and each notice can be dismissed.
 */
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle, X } from 'lucide-react';
import { useOptionalTaskManager, type RunningTask } from '@/lib/tasks/TaskManagerContext';

function Toast({ task, onDismiss }: { task: RunningTask; onDismiss: () => void }) {
  const running = task.status === 'running';
  const failed = task.status === 'failed';
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className="pointer-events-auto flex w-80 items-start gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-card"
    >
      {running && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary-ink" aria-hidden />}
      {task.status === 'completed' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />}
      {failed && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-negative" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-content">{task.title}</p>
        <p className="mt-0.5 text-[12px] text-muted">
          {running
            ? 'Researching and writing. You can keep working.'
            : failed
              ? task.error || 'It could not be completed.'
              : task.currentStep}
        </p>
        {task.status === 'completed' && task.link && (
          <Link to={task.link} onClick={onDismiss} className="mt-1.5 inline-block text-[12px] font-medium text-primary-ink hover:underline">
            Open report
          </Link>
        )}
      </div>
      {!running && (
        <button type="button" onClick={onDismiss} className="shrink-0 rounded p-0.5 text-muted hover:text-content" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function TaskToasts() {
  const manager = useOptionalTaskManager();
  const shown = (manager?.tasks ?? []).filter((t) => t.type === 'report');
  if (!manager || shown.length === 0) return null;
  const { dismissTask } = manager;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
      {shown.slice(0, 3).map((task) => (
        <Toast key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
      ))}
    </div>
  );
}
