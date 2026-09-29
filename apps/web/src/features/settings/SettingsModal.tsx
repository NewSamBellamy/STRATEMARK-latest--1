import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Cloud,
  Cpu,
  ExternalLink,
  Loader2,
  DatabaseBackup,
  Download,
  Github,
  Gauge,
  ImageOff,
  ShieldCheck,
  Upload,
  Trash2,
  Key,
} from 'lucide-react';
import { createGeminiClient } from '@mi/research';
import { exportSnapshot, importSnapshot, marketCountOf } from '@/lib/repository/vault';
import { clearAccess, getAccessProfile } from '@/lib/access';
import {
  DAILY_REQUEST_CAP,
  getCostControls,
  getSpend,
  getUsage,
  isLowPower,
  setCostControls,
  subscribeUsage,
} from '@/lib/usage';
import { looksLikeGeminiKey, sanitizeApiKey, useApiKey } from '@/lib/settings/apiKey';
import { useEngineChoice } from '@/lib/settings/engine';
import { useAuth } from '@/lib/auth/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { useSettingsModal } from '@/lib/settings/settingsModal';
import { cn } from '@/lib/cn';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; detail?: string };

type TabId = 'general' | 'engine' | 'data' | 'usage' | 'pricing';

export function SettingsModal() {
  const { isOpen, close } = useSettingsModal();
  const [activeTab, setActiveTab] = useState<TabId>('general');

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && close()}
      title="Settings"
      size="2xl"
    >
      <div className="mt-2 flex h-[65vh] min-h-[500px] flex-col overflow-hidden border-t border-border sm:flex-row">
        
        {/* Sidebar Navigation */}
        <nav className="flex shrink-0 flex-row overflow-x-auto border-b border-border bg-surface-2/30 p-2 sm:w-48 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:pr-2 sm:pt-4">
          <TabButton id="general" active={activeTab} onClick={setActiveTab} icon={Key} label="General" />
          <TabButton id="engine" active={activeTab} onClick={setActiveTab} icon={Cpu} label="Engine" />
          <TabButton id="data" active={activeTab} onClick={setActiveTab} icon={DatabaseBackup} label="Data controls" />
          <TabButton id="usage" active={activeTab} onClick={setActiveTab} icon={Gauge} label="Usage & billing" />
          <TabButton id="pricing" active={activeTab} onClick={setActiveTab} icon={BadgeCheck} label="Builder profile" />
        </nav>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'engine' && <EngineTab />}
          {activeTab === 'data' && <DataSafetyPanel />}
          {activeTab === 'usage' && <UsageBillingPanel />}
          {activeTab === 'pricing' && <PricingPanel />}
        </div>
      </div>
    </Modal>
  );
}

function TabButton({ id, active, onClick, icon: Icon, label }: { id: TabId, active: TabId, onClick: (id: TabId) => void, icon: React.ElementType, label: string }) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        'flex w-full shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors',
        isActive ? 'bg-surface-2 text-content' : 'text-muted hover:bg-surface-2 hover:text-content'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function GeneralTab() {
  const { model, hasKey, setApiKey, setModel, clear, apiKey } = useApiKey();
  const [draft, setDraft] = useState(apiKey);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  const save = () => {
    setApiKey(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testKey = async () => {
    const key = sanitizeApiKey(draft);
    if (!key) return;
    setTest({ status: 'testing' });
    try {
      const client = createGeminiClient({ apiKey: key, model: model || undefined });
      const res = await client.ground(
        'In one short sentence, what is today\'s date according to search results?',
      );
      setTest({
        status: 'ok',
        detail: `Grounded search returned ${res.citations.length} source${res.citations.length === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTest({
        status: 'fail',
        detail: /404/.test(msg)
          ? 'That model isn’t available to your account. Clear the model override or try another.'
          : /ISO-8859-1|headers.*RequestInit/i.test(msg)
            ? 'Your key contained an invisible character (a smart quote or non-breaking space picked up while copying). We’ve cleaned it — press Test key again.'
            : /API key not valid|400|403/.test(msg)
              ? 'Key rejected by Google. Check you copied it fully from AI Studio.'
              : /429/.test(msg)
                ? 'Rate limited (429). Your key works, but you’ve hit the free-tier quota.'
                : /Failed to fetch|NetworkError/i.test(msg)
                  ? 'Couldn’t reach Google. Check your connection, VPN, or ad-blocker.'
                  : msg.slice(0, 180),
      });
    }
  };

  return (
    <div className="space-y-6 pb-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-display text-lg text-content">Google AI Studio API key</h2>
          {hasKey && (
            <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected
            </span>
          )}
        </div>
        <p className="text-sm text-muted mb-4">Connect Gemini to run live grounded research.</p>

        <label className="label" htmlFor="key">API key</label>
        <input
          id="key"
          type="password"
          className="input font-mono w-full"
          placeholder="AIza…"
          value={draft}
          onChange={(e) => setDraft(sanitizeApiKey(e.target.value))}
          onPaste={(e) => {
            e.preventDefault();
            setDraft(sanitizeApiKey(e.clipboardData.getData('text')));
          }}
          autoComplete="off"
          spellCheck={false}
        />
        {draft.length > 0 && !looksLikeGeminiKey(draft) && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            That doesn’t look like a complete AI Studio key. Try copying it again from AI Studio.
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          Get a free key at{' '}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary-ink hover:underline"
          >
            aistudio.google.com/app/apikey <ExternalLink className="h-3 w-3" />
          </a>
          . Your key stays in this browser and is sent only to Google.
        </p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-content">
          Advanced: model override
        </summary>
        <div className="mt-2">
          <input
            className="input font-mono w-full"
            placeholder="gemini-flash-latest (default)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">
            Leave blank for the default rolling alias.
          </p>
        </div>
      </details>

      {test.status !== 'idle' && (
        <div
          className={
            test.status === 'ok'
              ? 'flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
              : test.status === 'fail'
                ? 'flex items-start gap-2 rounded-lg border border-negative/40 bg-red-50 px-3 py-2 text-sm text-red-800'
                : 'flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted'
          }
          role="status"
        >
          {test.status === 'testing' && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
          {test.status === 'ok' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {test.status === 'fail' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {test.status === 'testing' && 'Testing your key against Gemini…'}
            {test.status === 'ok' && <><strong>Key works.</strong> {test.detail}</>}
            {test.status === 'fail' && <><strong>Key test failed.</strong> {test.detail}</>}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button type="button" className="btn-primary" onClick={save} disabled={!draft.trim()}>
          {saved ? 'Saved ✓' : 'Save key'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={testKey}
          disabled={!draft.trim() || test.status === 'testing'}
        >
          {test.status === 'testing' ? 'Testing…' : 'Test key'}
        </button>
        {hasKey && (
          <button
            type="button"
            className="btn-ghost text-negative"
            onClick={() => {
              clear();
              setDraft('');
            }}
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        Your key is stored only in this browser and sent only to Google’s API.
      </div>
      
      <AccessPanel />
    </div>
  );
}

function EngineTab() {
  const { user } = useAuth();
  const { engine, setEngine } = useEngineChoice();
  const isPro = user?.subscriptionTier === 'pro';

  return (
    <div className="space-y-6 pb-6">
      <div>
        <h2 className="font-display text-lg text-content">Research Execution Engine</h2>
        <p className="mt-1 text-sm text-muted">
          Choose where your competitive intelligence and deck research runs.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={() => setEngine('cloud')}
          className={`flex flex-col items-start rounded-xl border p-4 text-left transition-all ${
            engine === 'cloud'
              ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/40'
              : 'border-border bg-surface-2 hover:border-border-strong'
          }`}
        >
          <div className="flex items-center gap-2 font-medium text-content text-sm">
            <Cloud className="h-4 w-4 text-primary-ink" />
            <span>Sentinel Cloud Agent</span>
            {isPro && <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] py-0 px-1.5">Default (Pro)</span>}
          </div>
          <p className="mt-2 text-xs text-muted leading-relaxed">
            Multi-pass research pipeline running on Cloud Run. Automatically links 24/7 CourtListener legal & market monitoring.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setEngine('local')}
          className={`flex flex-col items-start rounded-xl border p-4 text-left transition-all ${
            engine === 'local'
              ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/40'
              : 'border-border bg-surface-2 hover:border-border-strong'
          }`}
        >
          <div className="flex items-center gap-2 font-medium text-content text-sm">
            <Cpu className="h-4 w-4 text-muted" />
            <span>Local Engine</span>
          </div>
          <p className="mt-2 text-xs text-muted leading-relaxed">
            Runs grounded search directly in your local browser / desktop client using your connected Gemini API key.
          </p>
        </button>
      </div>
    </div>
  );
}

function DataSafetyPanel() {
  const KEY = 'mi.repo.v1';
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const read = (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const current = read(KEY);
  const backup = read(`${KEY}.backup`);
  const currentMarkets = marketCountOf(current);
  const backupMarkets = marketCountOf(backup);
  const sizeKb = current ? Math.round(current.length / 1024) : 0;

  const restoreBackup = () => {
    if (!backup) return;
    if (current) {
      try {
        localStorage.setItem(`${KEY}.backup`, current);
      } catch {
        /* best effort */
      }
    }
    try {
      localStorage.setItem(KEY, backup);
      window.location.reload();
    } catch {
      setMsg('Restore failed — storage is full. Export your research first.');
    }
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const markets = await importSnapshot(text, KEY);
    if (markets < 0) {
      setMsg("That file isn't a Stratemark research export.");
      return;
    }
    window.location.reload();
  };

  return (
    <div className="space-y-6 pb-6">
      <div>
        <h2 className="font-display text-lg text-content">Data safety</h2>
        <p className="mt-1 text-sm text-muted">
          Your research is written to three places: this browser, an IndexedDB vault, and an automatic backup.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
        <span className="text-content">
          <span className="font-semibold tabular-nums">{Math.max(currentMarkets, 0)}</span>{' '}
          deck{currentMarkets === 1 ? '' : 's'} stored
        </span>
        <span className="text-muted tabular-nums">{sizeKb} KB</span>
        {backupMarkets > 0 && (
          <span className="text-muted">
            backup: <span className="tabular-nums">{backupMarkets}</span> deck{backupMarkets === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost text-sm border border-border"
          disabled={!current}
          onClick={() => {
            if (!exportSnapshot(KEY)) setMsg('Nothing to export yet.');
          }}
        >
          <Download className="h-4 w-4" /> Export my research
        </button>
        <button
          type="button"
          className="btn-ghost text-sm border border-border"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" /> Import
        </button>
        {backupMarkets > 0 && backupMarkets > Math.max(currentMarkets, 0) && (
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={restoreBackup}
          >
            <DatabaseBackup className="h-4 w-4" /> Restore {backupMarkets} decks
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {msg && <p className="text-[12px] text-negative">{msg}</p>}

      <div className="border-t border-border pt-6">
        <h2 className="font-display text-lg text-content">Storage & Desktop App</h2>
        <p className="mt-1 text-sm text-muted">
          Right now your research lives in this browser.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-4">
          <div>
            <p className="text-sm font-semibold text-content">STRATEMARK Desktop</p>
            <p className="mt-0.5 text-xs text-muted">
              Everything fully local — your key in the OS keychain, your decks on your disk.
            </p>
          </div>
          <span className="chip border-border bg-surface text-muted">Coming with launch</span>
        </div>
      </div>
    </div>
  );
}

function UsageBillingPanel() {
  const [, force] = useState(0);
  useEffect(() => subscribeUsage(() => force((n) => n + 1)), []);
  const usage = getUsage();
  const spend = getSpend();
  const controls = getCostControls();
  const lowPower = isLowPower();
  const [capDraft, setCapDraft] = useState(
    controls.monthlyCapUsd != null ? String(controls.monthlyCapUsd) : '',
  );

  const applyCap = () => {
    const n = Number(capDraft);
    setCostControls({ monthlyCapUsd: capDraft.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n });
  };

  const usd = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="space-y-6 pb-6">
      <div>
        <h2 className="font-display text-lg text-content">Usage & billing</h2>
      </div>

      {lowPower && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Low power mode — your spending cap is reached. Autonomous research is paused.
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-2 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-content">This month on your key</p>
          <p className="font-display text-2xl font-bold tabular-nums text-content">
            {usd(spend.estUsd)}
            <span className="ml-1 text-[11px] font-medium text-faint">est.</span>
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="font-display text-sm font-bold tabular-nums text-content">{spend.grounded}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted">searches</p>
            <p className="text-[10px] tabular-nums text-faint">{usd(spend.estByKind.ground)}</p>
          </div>
          <div>
            <p className="font-display text-sm font-bold tabular-nums text-content">{spend.structure}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted">extractions</p>
            <p className="text-[10px] tabular-nums text-faint">{usd(spend.estByKind.structure)}</p>
          </div>
          <div>
            <p className="font-display text-sm font-bold tabular-nums text-content">{spend.image}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted">images</p>
            <p className="text-[10px] tabular-nums text-faint">{usd(spend.estByKind.image)}</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Estimates from published list prices, counted locally. Today: {usage.total} of {DAILY_REQUEST_CAP} free-tier requests
          (~{usage.decksLeft} more decks).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content">Monthly spending cap</p>
          <p className="mt-0.5 text-xs text-muted">Hit the cap and the app scales back to low power mode.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">$</span>
          <input
            className="input w-24 py-1.5 text-sm tabular-nums"
            inputMode="decimal"
            placeholder="none"
            value={capDraft}
            onChange={(e) => setCapDraft(e.target.value)}
            onBlur={applyCap}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyCap();
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-content">
            <ImageOff className="h-4 w-4 text-muted" />
            Generated imagery
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Card art, article covers, HQ scenes.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={controls.imagesEnabled}
          onClick={() => setCostControls({ imagesEnabled: !controls.imagesEnabled })}
          className={
            controls.imagesEnabled
              ? 'relative h-6 w-11 shrink-0 rounded-full bg-primary transition-colors'
              : 'relative h-6 w-11 shrink-0 rounded-full bg-surface transition-colors border border-border'
          }
        >
          <span
            className={
              controls.imagesEnabled
                ? 'absolute left-[22px] top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all'
                : 'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-muted/40 shadow transition-all'
            }
          />
        </button>
      </div>
    </div>
  );
}

function PricingPanel() {
  const [oneTime, setOneTime] = useState(10);
  const TIERS = [
    { name: 'Starter', price: 19, blurb: 'Up to 10 decks a month, daily briefings, generated card art included.', highlight: false },
    { name: 'Growth', price: 49, blurb: 'More room to run: 40 decks a month, everything in Starter, priority research lanes.', highlight: true },
    { name: 'Max', price: 99, blurb: 'For teams living in the product: 150 decks a month and the full feature surface.', highlight: false },
  ];
  return (
    <div className="space-y-6 pb-6">
      <div>
        <h2 className="font-display text-lg text-content">Pricing — three doors</h2>
        <p className="mt-1 text-sm text-muted">
          Research runs on your own Gemini key — we never see it. Pick how you want the app to arrive.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative rounded-xl border border-border bg-surface-2/60 p-4">
          <p className="text-sm font-semibold text-content">Free</p>
          <p className="text-[11px] font-medium text-faint">Demo & open source</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-content">$0</p>
          <a
            href="https://github.com/NewSamBellamy/STRATEMARK"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost mt-3 w-full justify-center py-1.5 text-[12px] border border-border"
          >
            <Github className="h-3.5 w-3.5" /> View on GitHub
          </a>
        </div>

        <div className="relative rounded-xl border-2 border-primary bg-primary/5 p-4">
          <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">
            Prefer not to build it?
          </span>
          <p className="text-sm font-semibold text-content">Easy install</p>
          <p className="text-[11px] font-medium text-faint">One-time · you choose</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums text-content">
            ${oneTime}
            <span className="text-[11px] font-medium text-faint"> one-time</span>
          </p>
          <input
            type="range"
            min={1}
            max={100}
            value={oneTime}
            onChange={(e) => setOneTime(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <button
            type="button"
            className="btn-primary mt-3 w-full justify-center py-1.5 text-[12px] opacity-60"
            disabled
          >
            Get easy install · ${oneTime}
          </button>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-sm font-semibold text-content">Stratemark Pro — subscription</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Fully hosted on Google Cloud — no API key to manage, usage included up to your tier's monthly cap.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={
                t.highlight
                  ? 'relative rounded-xl border-2 border-primary bg-primary/5 p-4'
                  : 'relative rounded-xl border border-border bg-surface-2/60 p-4'
              }
            >
              {t.highlight && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">
                  Popular
                </span>
              )}
              <p className="text-sm font-semibold text-content">{t.name}</p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-content">
                ${t.price}
                <span className="text-[11px] font-medium text-faint">/mo</span>
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{t.blurb}</p>
              <button
                type="button"
                className="btn-primary mt-3 w-full justify-center py-1.5 text-[12px] opacity-60"
                disabled
              >
                Subscribe
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccessPanel() {
  const profile = getAccessProfile();
  if (!profile) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
      <div>
        <h2 className="font-display text-lg text-content">Preview access</h2>
        <p className="mt-1 text-sm text-muted">
          Signed in as <span className="font-semibold text-content">{profile.name}</span>
          {profile.kind === 'test' ? ' (test account)' : ''}.
        </p>
      </div>
      <button
        type="button"
        className="btn-ghost text-sm border border-border"
        onClick={() => {
          clearAccess();
          window.location.reload();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
