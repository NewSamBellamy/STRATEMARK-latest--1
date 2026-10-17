/**
 * "Create report" for a company: pick the sections, optionally say what to
 * concentrate on, and Stratemark does the rest in the background. The dialog
 * says plainly what happens, because the report does more than print what is
 * stored: it reads the research it already has, finds what is missing,
 * researches those gaps, then writes it up.
 */
import { useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { REPORT_TOPICS, REPORT_TOPIC_LABELS, type ReportTopic } from '@mi/contracts';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';

const TOPIC_HINTS: Record<ReportTopic, string> = {
  overview: 'What the company does and where it stands',
  metrics: 'The figures that are sourced, and the ones that are not',
  live_intel: 'Recent news and what people are saying',
  team_org: 'Who runs it and how it is organised',
  products_roadmap: 'What it sells and what is coming',
  history: 'How it got here',
  mission_governance: 'Mission, board, funding and investors',
  sources: 'Every source behind the report',
};

/** The sections ticked by default: everything except the bare source list. */
const DEFAULT_TOPICS: ReportTopic[] = REPORT_TOPICS.filter((t) => t !== 'sources');

export interface ReportBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyName: string;
  onStart: (input: { topics: ReportTopic[]; focus: string | null }) => void;
}

export function ReportBuilderDialog({ open, onOpenChange, companyName, onStart }: ReportBuilderDialogProps) {
  const [picked, setPicked] = useState<ReportTopic[]>(DEFAULT_TOPICS);
  const [focus, setFocus] = useState('');

  const toggle = (topic: ReportTopic) =>
    setPicked((current) => (current.includes(topic) ? current.filter((t) => t !== topic) : [...current, topic]));

  const start = () => {
    if (picked.length === 0) return;
    // Keep the report in the dashboard's own tab order, whatever order they were ticked in.
    onStart({ topics: REPORT_TOPICS.filter((t) => picked.includes(t)), focus: focus.trim() || null });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogTitle className="font-display text-lg font-semibold text-content">Create a report on {companyName}</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] leading-relaxed text-muted">
          Stratemark reads the research it already has, finds what is missing, researches those gaps, then writes it up
          with sources. You can keep working; you will be told when it is ready.
        </DialogDescription>

        <fieldset className="mt-4">
          <legend className="text-[11px] font-semibold uppercase tracking-widest text-faint">Include</legend>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {REPORT_TOPICS.map((topic) => {
              const on = picked.includes(topic);
              return (
                <li key={topic}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                      on ? 'border-primary/50 bg-primary/5' : 'border-border bg-surface hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--color-primary,#0f766e)]"
                      checked={on}
                      onChange={() => toggle(topic)}
                    />
                    <span>
                      <span className="block text-[13px] font-medium text-content">{REPORT_TOPIC_LABELS[topic]}</span>
                      <span className="block text-[11.5px] text-faint">{TOPIC_HINTS[topic]}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <label className="mt-4 block text-[11px] font-semibold uppercase tracking-widest text-faint" htmlFor="report-builder-focus">
          Focus (optional)
        </label>
        <input
          id="report-builder-focus"
          className="input mt-1.5 py-2 text-sm"
          placeholder="e.g. pricing pressure, who they compete with"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        />

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[11.5px] text-muted">
            {picked.length === 0
              ? 'Pick at least one section.'
              : `${picked.length} ${picked.length === 1 ? 'section' : 'sections'}. Sourcing rules do not change; unknown stays unknown.`}
          </p>
          <button type="button" className="btn-primary shrink-0" disabled={picked.length === 0} onClick={start}>
            <FilePlus2 className="h-4 w-4" />
            Create report
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
