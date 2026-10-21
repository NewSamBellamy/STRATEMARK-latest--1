import { Link } from 'react-router-dom';
import { Download, HeartHandshake, KeyRound, Lock, MessageSquareText, PackageOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { SettingsLink } from '@/components/SettingsLink';
import { FEEDBACK_URL, OPEN_SOURCE_LAUNCH } from '@/lib/beta';

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex gap-4 border-b border-border py-5 last:border-0">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary-ink">{icon}</span>
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-semibold text-content">{title}</h2>
        <div className="mt-1 space-y-2 text-[14px] leading-relaxed text-muted">{children}</div>
      </div>
    </section>
  );
}

/** "About this beta": what we cover, what we never keep, and how you leave with everything. */
export default function BetaPage() {
  return (
    <div className="mx-auto max-w-2xl pb-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-ink">Stratemark beta</p>
      <h1 className="mt-1 font-display text-2xl font-semibold text-content sm:text-3xl">
        We want your honest feedback, not your data.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Stratemark is being built open source and local-first. This beta is a free web version so you can try it
        before the open-source release at {OPEN_SOURCE_LAUNCH}.
      </p>

      <div className="panel mt-6 px-5">
        <Point icon={<HeartHandshake className="h-4 w-4" />} title="We cover the AI and the servers">
          <p>
            During the beta we pay for the AI research and the backend, so you can use Stratemark without an API key
            or a card. There is a daily limit so the beta stays sustainable; if you reach it, you can add your own
            Gemini key in <SettingsLink className="font-medium text-primary-ink underline">Settings</SettingsLink> and keep going.
          </p>
        </Point>
        <Point icon={<Lock className="h-4 w-4" />} title="Your research stays with you">
          <p>
            Your decks, figures, reports and AI conversations are saved only in this browser. We don&apos;t have a
            database of your research, and we can&apos;t see it.
          </p>
          <p>
            To cover the AI cost, research requests pass through our server on their way to Google&apos;s Gemini API, and
            company websites are fetched through it too. We pass them straight through and don&apos;t store or log what
            they contain. The only thing we keep is a running total of today&apos;s AI spend (counted per IP address, to
            enforce the free limit), which resets every day.
          </p>
        </Point>
        <Point icon={<Download className="h-4 w-4" />} title="Export everything, any time">
          <p>
            One file holds all of it: every deck, card, sourced figure, report and conversation.{' '}
            <SettingsLink tab="data" className="font-medium text-primary-ink underline">Settings → Data controls → Export my research</SettingsLink>.
            Generated cover images aren&apos;t included; they&apos;re recreated when needed.
          </p>
          <p>Clearing your browser data deletes your research, so export a copy now and then.</p>
        </Point>
        <Point icon={<PackageOpen className="h-4 w-4" />} title="Take your decks to the open-source version">
          <p>
            When Stratemark launches open source at {OPEN_SOURCE_LAUNCH}, import that same file and carry on with
            everything you built here.
          </p>
        </Point>
        <Point icon={<KeyRound className="h-4 w-4" />} title="After the beta">
          <p>
            The open-source version is bring-your-own-key: free to run, with your own Gemini key and your own usage.
          </p>
        </Point>
        {FEEDBACK_URL && (
          <Point icon={<MessageSquareText className="h-4 w-4" />} title="Tell us what you think">
            <p>
              What worked, what broke, what you wished it did.{' '}
              <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-ink underline">
                Send feedback
              </a>
              . It&apos;s the most useful thing you can give us.
            </p>
          </Point>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/" className="btn-primary">Start a deck</Link>
        <SettingsLink tab="data" className="btn-ghost border border-border">Export my research</SettingsLink>
      </div>
    </div>
  );
}
