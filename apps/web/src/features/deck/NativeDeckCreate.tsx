import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  nativeResearchStartSchema,
  type NativeResearchStart,
  type NativeResearchRun,
} from '@mi/contracts';
import { useApiKey } from '@/lib/settings/apiKey';
import { SettingsLink } from '@/components/SettingsLink';
import { Button } from '@/components/ui/button';
import { qk } from '@/lib/query/keys';

const DRAFT = 'mi.native.scope-draft';
type ScopeDraft = {
  goal?: string;
  seeds?: string;
  exclusions?: string;
  region?: string;
  reviewed?: NativeResearchStart;
  submitted?: boolean;
};
function draft(): ScopeDraft {
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT) ?? '{}') as ScopeDraft;
    const reviewed = nativeResearchStartSchema.safeParse(stored.reviewed);
    return {
      goal: typeof stored.goal === 'string' ? stored.goal : '',
      seeds: typeof stored.seeds === 'string' ? stored.seeds : '',
      exclusions: typeof stored.exclusions === 'string' ? stored.exclusions : '',
      region: typeof stored.region === 'string' ? stored.region : '',
      reviewed: reviewed.success ? reviewed.data : undefined,
      submitted: stored.submitted === true && reviewed.success,
    };
  } catch {
    return {};
  }
}
const lines = (value: string) => [
  ...new Set(
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

export default function NativeDeckCreate() {
  const [initial] = useState(draft);
  const [goal, setGoal] = useState(initial.goal ?? '');
  const [seeds, setSeeds] = useState(initial.seeds ?? '');
  const [exclusions, setExclusions] = useState(initial.exclusions ?? '');
  const [region, setRegion] = useState(initial.region ?? '');
  const [review, setReview] = useState(initial.reviewed ?? null);
  const [submitted, setSubmitted] = useState(initial.submitted ?? false);
  const [reconciling, setReconciling] = useState(initial.submitted ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const hasKey = useApiKey((state) => state.hasKey);
  const fixture =
    !!window.mi &&
    'researchProvenance' in window.mi &&
    window.mi.researchProvenance === 'synthetic_fixture';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const retain = useCallback(
    (reviewed = review, awaitingAcceptance = submitted) => {
      try {
        localStorage.setItem(
          DRAFT,
          JSON.stringify({
            goal,
            seeds,
            exclusions,
            region,
            reviewed,
            submitted: awaitingAcceptance,
          }),
        );
        return true;
      } catch {
        setError(
          'This device could not save your scope draft. No new request will be sent until local storage is restored.',
        );
        return false;
      }
    },
    [goal, seeds, exclusions, region, review, submitted],
  );
  useEffect(() => {
    retain();
  }, [retain]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const accept = useCallback(
    (run: NativeResearchRun) => {
      qc.setQueryData<NativeResearchRun[]>(['native-runs'], (runs = []) => [
        run,
        ...runs.filter((item) => item.id !== run.id),
      ]);
      void qc.invalidateQueries({ queryKey: ['native-runs'] });
      void qc.invalidateQueries({ queryKey: qk.markets });
      // Acceptance is durable in the service. Returning to /new begins a fresh review.
      try {
        localStorage.setItem(
          DRAFT,
          JSON.stringify({ ...draft(), reviewed: null, submitted: false }),
        );
      } catch {
        /* A retained pending key will safely reconcile to this same run on reload. */
      }
      navigate(`/markets/${run.marketId}/deck`);
    },
    [qc, navigate],
  );
  useEffect(() => {
    if (!initial.submitted || !initial.reviewed) return;
    let live = true;
    const reconcile = async () => {
      try {
        if (!window.mi?.listNativeRuns)
          throw new Error('Reconnect the native workspace to check the saved request.');
        const runs = await window.mi.listNativeRuns();
        if (!live) return;
        const existing = runs.find((run) => run.requestKey === initial.reviewed!.requestKey);
        if (existing) accept(existing);
        else
          setError(
            'The previous start is not confirmed. Retry uses the same saved request; research will not restart automatically.',
          );
      } catch (failure) {
        if (live)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not check the saved request. Retry keeps its request key.',
          );
      } finally {
        if (live) setReconciling(false);
      }
    };
    void reconcile();
    return () => {
      live = false;
    };
  }, [initial, accept]);
  useEffect(
    () =>
      window.mi?.onDeckRefresh?.(() => {
        void qc.invalidateQueries({ queryKey: ['native-runs'] });
        void qc.invalidateQueries({ queryKey: qk.markets });
      }),
    [qc],
  );
  function edit(set: (value: string) => void, value: string) {
    set(value);
    setReview(null);
    setSubmitted(false);
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (pending || reconciling) return;
    if (window.mi?.nativeResearchWritable === false) {
      setError(
        'Research is disabled in this workspace. Saved results remain readable; use a separate live workspace to research real companies.',
      );
      return;
    }
    try {
      if (!review) {
        const input = nativeResearchStartSchema.parse({
          requestKey: `research_${crypto.randomUUID()}`,
          scope: {
            goal: goal.trim(),
            inclusions: [],
            exclusions: lines(exclusions),
            region: region.trim() || null,
            depth: 'quick',
            seeds: lines(seeds).map((name) => ({ name })),
          },
          maxCompanies: 12,
          limits: {
            maxRequests: 315,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 300_000,
            maxSourceRequests: 12,
          },
        });
        if (retain(input, false)) setReview(input);
        return;
      }
      if (!window.mi?.startNativeResearch)
        throw new Error('Native research is unavailable. Your reviewed scope is saved.');
      if (!hasKey && !fixture)
        throw new Error(
          'Connect a Gemini key before starting research. Your reviewed scope is saved.',
        );
      if (!retain(review, true)) return;
      setSubmitted(true);
      setPending(true);
      // A failed response is ambiguous: check acceptance before retrying the same key.
      const existing = submitted
        ? (await window.mi.listNativeRuns!()).find((run) => run.requestKey === review.requestKey)
        : undefined;
      const run = existing ?? (await window.mi.startNativeResearch(review));
      if (mounted.current) accept(run);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Research could not start. Your reviewed request is saved.',
        );
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <section className="mx-auto max-w-2xl py-8">
      {window.mi?.nativeResearchWritable === false && (
        <p role="status" className="mb-5 text-sm text-muted">
          Research is disabled on this provenance-preserving reopen. Existing results remain
          available in Library.
        </p>
      )}
      {fixture && (
        <p
          role="status"
          className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950"
        >
          Synthetic fixture research · Canned provider responses · No provider calls or live
          research.
        </p>
      )}
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">
        New research deck
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-content">
        What do you want to understand?
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Define a focused market and a question. Your research will be saved locally as it arrives.
      </p>
      <form
        className="mt-8 space-y-5"
        onSubmit={(event) => void submit(event)}
        onBlur={() => retain()}
      >
        <label className="block text-sm font-medium text-content">
          Market and research question
          <textarea
            required
            disabled={pending || reconciling}
            maxLength={20_000}
            value={goal}
            onChange={(event) => edit(setGoal, event.target.value)}
            className="mt-2 w-full rounded-xl border border-border bg-surface p-4 text-sm"
            rows={3}
            placeholder="Which frontier AI labs offer practical alternatives to the largest providers?"
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-content">
            Companies to include <span className="text-muted">(one per line)</span>
            <textarea
              disabled={pending || reconciling}
              value={seeds}
              onChange={(event) => edit(setSeeds, event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-surface p-3 text-sm"
              rows={3}
              placeholder={'Mistral AI\nCohere'}
            />
          </label>
          <label className="block text-sm font-medium text-content">
            Exclude <span className="text-muted">(one per line)</span>
            <textarea
              disabled={pending || reconciling}
              value={exclusions}
              onChange={(event) => edit(setExclusions, event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-surface p-3 text-sm"
              rows={3}
            />
          </label>
        </div>
        <label className="block text-sm font-medium text-content">
          Region <span className="text-muted">(optional)</span>
          <input
            disabled={pending || reconciling}
            value={region}
            maxLength={160}
            onChange={(event) => edit(setRegion, event.target.value)}
            className="mt-2 w-full rounded-xl border border-border bg-surface p-3 text-sm"
            placeholder="Global"
          />
        </label>
        {review && (
          <div className="rounded-xl border border-primary/20 bg-surface-2 p-5 text-sm leading-6 text-content">
            <h2 className="font-semibold">Review this research pass</h2>
            <p>
              {fixture
                ? 'Quick company map · up to 12 companies · synthetic responses, no web retrieval.'
                : 'Quick company map · up to 12 companies · Gemini with web grounding.'}
            </p>
            <p className="mt-2">
              Ceilings: 315 provider requests, 2 million input tokens and 300,000 output tokens,
              including retries. These are maximum allowances, not expected usage or a guaranteed
              dollar cap.
            </p>
            <p className="mt-2">
              {review.limits.maxSourceRequests == null || review.limits.maxSourceRequests === 0
                ? 'No public page capture was approved for this saved request. Retrying keeps that allowance unchanged.'
                : fixture
                  ? `Source ceiling: ${review.limits.maxSourceRequests} source requests. This synthetic fixture uses canned source material, not public page retrieval.`
                  : `Source ceiling: ${review.limits.maxSourceRequests} source requests, including failed or blocked attempts. Approving allows capture of public pages during research, at most 2 citation pages per company after cards are saved. Reading saved evidence never starts a capture.`}
            </p>
            <p className="mt-2 text-muted">
              Only this scope is sent for research. Missing companies and failed steps will be
              shown. This preview does not yet generate all seven categories or verify exact source
              passages. Retained page text is source material, not verified support for a claim.
            </p>
          </div>
        )}
        {!hasKey && !fixture && (
          <p className="text-sm text-muted">
            Your scope is kept while you <SettingsLink>connect a Gemini key</SettingsLink>. Saved
            research remains readable without a key.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="blue"
          disabled={
            window.mi?.nativeResearchWritable === false ||
            pending ||
            reconciling ||
            !goal.trim() ||
            (!!review && !hasKey && !fixture)
          }
        >
          {reconciling
            ? 'Checking your saved request…'
            : pending
              ? 'Saving your research run…'
              : review
                ? 'Approve and start research'
                : 'Review scope'}
        </Button>
      </form>
    </section>
  );
}
