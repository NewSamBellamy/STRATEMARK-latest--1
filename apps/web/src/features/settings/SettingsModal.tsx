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
  ShieldCheck,
  Upload,
  Trash2,
  Key,
} from 'lucide-react';
import { createGeminiClient } from '@mi/research';
import type { MigrationReadiness, ResearchStorageInfo } from '@mi/contracts';
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
import { isCommunityDesktop, isNativeResearch } from '@/lib/settings/runtime';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; detail?: string };

type TabId = 'general' | 'engine' | 'data' | 'usage' | 'pricing';

export function SettingsModal() {
  const { isOpen, close } = useSettingsModal();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const communityDesktop = isCommunityDesktop();

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && close()}
      title="Settings"
      description={
        communityDesktop
          ? 'Manage your Gemini key, local usage, and saved data.'
          : 'Manage your research key, engine, and saved data.'
      }
      size="2xl"
    >
      <div className="mt-2 flex h-[65vh] min-h-[500px] flex-col overflow-hidden border-t border-border sm:flex-row">
        {/* Sidebar Navigation */}
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 flex-row overflow-x-auto border-b border-border bg-surface-2/30 p-2 sm:w-48 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:pr-2 sm:pt-4"
        >
          <TabButton
            id="general"
            active={activeTab}
            onClick={setActiveTab}
            icon={Key}
            label="General"
          />
          {!communityDesktop && (
            <TabButton
              id="engine"
              active={activeTab}
              onClick={setActiveTab}
              icon={Cpu}
              label="Engine"
            />
          )}
          <TabButton
            id="data"
            active={activeTab}
            onClick={setActiveTab}
            icon={DatabaseBackup}
            label="Data controls"
          />
          <TabButton
            id="usage"
            active={activeTab}
            onClick={setActiveTab}
            icon={Gauge}
            label={communityDesktop ? 'Usage & limits' : 'Usage & billing'}
          />
          <TabButton
            id="pricing"
            active={activeTab}
            onClick={setActiveTab}
            icon={BadgeCheck}
            label={communityDesktop ? 'About' : 'Builder profile'}
          />
        </nav>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'engine' && !communityDesktop && <EngineTab />}
          {activeTab === 'data' &&
            (isNativeResearch() ? (
              <p className="text-sm text-muted">
                Research is stored in this local workspace. Backup, restore and migration controls
                are not connected yet. Existing legacy libraries are not automatically migrated.
              </p>
            ) : communityDesktop ? (
              <DesktopDataPanel />
            ) : (
              <DataSafetyPanel />
            ))}
          {activeTab === 'usage' &&
            (isNativeResearch() ? (
              <p className="text-sm text-muted">
                Each deck shows its persisted research allowance and request/token usage. Provider
                billing is separate; an accurate dollar total is not available here.
              </p>
            ) : (
              <UsageBillingPanel />
            ))}
          {activeTab === 'pricing' && (communityDesktop ? <CommunityPanel /> : <PricingPanel />)}
        </div>
      </div>
    </Modal>
  );
}

function TabButton({
  id,
  active,
  onClick,
  icon: Icon,
  label,
}: {
  id: TabId;
  active: TabId;
  onClick: (id: TabId) => void;
  icon: React.ElementType;
  label: string;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={() => onClick(id)}
      className={cn(
        'flex w-auto shrink-0 items-center gap-2 rounded-lg px-2 py-2.5 text-[13px] font-medium transition-colors sm:w-full sm:gap-3 sm:px-3',
        isActive ? 'bg-surface-2 text-content' : 'text-muted hover:bg-surface-2 hover:text-content',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function GeneralTab() {
  const native = isNativeResearch();
  const { model, hasKey, setApiKey, setModel, clear, apiKey, storageError } = useApiKey();
  const [draft, setDraft] = useState(apiKey);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(apiKey);
  }, [apiKey]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await setApiKey(draft);
      setSaved(true);
    } catch {
      setSaveError('Your key was not saved. Check that secure storage is available and try again.');
    } finally {
      setSaving(false);
    }
  };

  const testKey = async () => {
    const key = sanitizeApiKey(draft);
    if (!key) return;
    setTest({ status: 'testing' });
    try {
      const client = createGeminiClient({
        apiKey: key,
        model: native ? undefined : model || undefined,
      });
      const res = await client.ground(
        "In one short sentence, what is today's date according to search results?",
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

  if (native && window.mi?.researchProvenance === 'synthetic_fixture')
    return (
      <div className="space-y-3">
        <h2 className="font-display text-lg">Synthetic fixture connection</h2>
        <p className="text-sm text-muted">
          This development walkthrough uses canned research responses with no key, search or
          provider calls. It does not test live research quality or billing. Use a separate live
          workspace to configure your own key; synthetic results cannot continue with a live
          provider.
        </p>
      </div>
    );

  return (
    <div className="space-y-6 pb-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-display text-lg text-content">Google AI Studio API key</h2>
          {hasKey && (
            <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> {native ? 'Key saved' : 'Connected'}
            </span>
          )}
        </div>
        <p className="text-sm text-muted mb-4">Connect Gemini to run live grounded research.</p>

        {isCommunityDesktop() && (
          <p className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
            Research runs from this device with your key. No Stratemark account or hosted service is
            required.
          </p>
        )}

        <label className="label" htmlFor="key">
          API key
        </label>
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
          . Your key is sent only to Google.{' '}
          {isCommunityDesktop()
            ? 'It is encrypted on disk using your operating system’s key storage.'
            : 'It is saved in this browser.'}
        </p>
      </div>

      {native ? (
        <p className="text-xs text-muted">
          New research currently uses the default Gemini research model. Additional providers and
          per-agent model selection are not connected yet. Saved research needs no key.
        </p>
      ) : (
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
            <p className="mt-1 text-xs text-muted">Leave blank for the default rolling alias.</p>
          </div>
        </details>
      )}

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
          {test.status === 'testing' && (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          )}
          {test.status === 'ok' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {test.status === 'fail' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {test.status === 'testing' && 'Testing your key against Gemini…'}
            {test.status === 'ok' && (
              <>
                <strong>Key works.</strong> {test.detail}
              </>
            )}
            {test.status === 'fail' && (
              <>
                <strong>Key test failed.</strong> {test.detail}
              </>
            )}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void save()}
          disabled={!draft.trim() || saving}
        >
          {saved ? 'Saved ✓' : 'Save key'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={testKey}
          disabled={native || !draft.trim() || test.status === 'testing'}
        >
          {test.status === 'testing' ? 'Testing…' : 'Test key'}
        </button>
        {hasKey && (
          <button
            type="button"
            className="btn-ghost text-negative"
            onClick={() => {
              void clear()
                .then(() => {
                  setDraft('');
                  setSaved(false);
                })
                .catch(() => {
                  setSaveError('Your key could not be removed. Please try again.');
                });
            }}
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        )}
      </div>
      {native && (
        <p className="text-xs text-muted">
          Standalone key testing is not connected to native run controls yet. Starting a reviewed
          research run uses its approved request/token allowance.
        </p>
      )}

      <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        Your key is stored on this device and sent only to Google’s API.
      </div>
      {(saveError || storageError) && (
        <p role="alert" className="text-sm text-negative">
          {saveError || storageError}
        </p>
      )}

      {!isCommunityDesktop() && <AccessPanel />}
    </div>
  );
}

function EngineTab() {
  const { user } = useAuth();
  const { engine, setEngine } = useEngineChoice();
  const isPro = user?.subscriptionTier === 'pro';

  if (isCommunityDesktop())
    return (
      <div className="space-y-3">
        <h2 className="font-display text-lg">Local Engine</h2>
        <p className="text-sm text-muted">
          Research runs on this device with your Gemini key. Google handles the AI requests; no
          Stratemark account or hosted service is required.
        </p>
      </div>
    );

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
            {isPro && (
              <span className="chip border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] py-0 px-1.5">
                Default (Pro)
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted leading-relaxed">
            Multi-pass research pipeline running on Cloud Run. Automatically links 24/7
            CourtListener legal & market monitoring.
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
            Runs grounded search directly in your local browser / desktop client using your
            connected Gemini API key.
          </p>
        </button>
      </div>
    </div>
  );
}

function CommunityPanel() {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg">Stratemark Community</h2>
      <p className="text-sm text-muted">
        Open-source desktop research, licensed under MIT. No account or subscription required.
        Research is stored on this device; Gemini requests use your own key and Google’s quotas.
      </p>
      <a
        className="btn-ghost"
        href="https://github.com/lYlarufAhmed/STRATEMARK-latest-"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Github className="h-4 w-4" /> Source code
      </a>
    </div>
  );
}

function DesktopDataPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<ResearchStorageInfo | null>(null);
  const [readiness, setReadiness] = useState<MigrationReadiness | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void window.miSecure
      ?.getResearchStorageInfo()
      .then((value) => {
        if (live) setInfo(value);
      })
      .catch(() => {
        if (live) setMessage('Could not read desktop storage.');
      });
    return () => {
      live = false;
    };
  }, []);
  const exportData = async () => {
    try {
      const json = await window.miSecure?.exportResearch();
      if (!json) {
        setMessage('Nothing to export yet.');
        return;
      }
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `stratemark-research-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMessage('Export failed. Your saved research has not been changed.');
    }
  };
  const importData = async (file: File) => {
    if (
      !window.confirm(
        'Replace this workspace with the selected research export? The current workspace will be backed up.',
      )
    )
      return;
    setBusy(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Export exceeds 50 MB.');
      await window.miSecure!.importResearch(await file.text());
      window.location.reload();
    } catch {
      setMessage(
        'Import failed. Choose a valid Stratemark export and finish or cancel active research first.',
      );
    } finally {
      setBusy(false);
    }
  };
  const checkMigrationReadiness = async () => {
    if (
      !window.confirm(
        'Check whether your current research is ready for the future native vault? This reads data on this device and will not copy, convert, replace, or upload it.',
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    setReadiness(null);
    try {
      setReadiness(await window.miSecure!.preflightResearchMigration());
    } catch {
      setMessage('Could not complete the readiness check safely. Your research was not changed.');
    } finally {
      setBusy(false);
    }
  };
  const blockedReason =
    readiness?.state === 'blocked'
      ? {
          source_missing: 'There is no saved workspace to check yet.',
          demo_workspace: 'The current library contains only the bundled sample research.',
          invalid_or_unsupported:
            'The current file could not be validated safely. No data was changed.',
          active_research: 'Finish or cancel active research, then check again.',
        }[readiness.reason]
      : null;
  return (
    <div className="space-y-5 pb-6">
      <h2 className="font-display text-lg">Data safety</h2>
      <p className="text-sm text-muted">
        Research is saved on your disk. Opening this page only inspects storage; it never repairs,
        replaces, or uploads your files. Exports contain research, not your API key, and are not
        encrypted.
      </p>
      {info && (
        <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-4 text-sm">
          {info.health === 'ready' && info.contentKind === 'workspace' && (
            <p className="font-semibold text-content">
              {`${info.deckCount} decks · ${info.marketCount} markets · ${Math.round(info.sizeBytes / 1024)} KB`}
            </p>
          )}
          {info.health === 'ready' && info.contentKind === 'demo' && (
            <p className="font-semibold text-content">Bundled sample research only</p>
          )}
          {info.health === 'empty' && (
            <p className="font-semibold text-content">No saved research yet</p>
          )}
          {info.health === 'recovery_needed' && (
            <p className="font-semibold text-negative">
              The current research file needs recovery. This page did not modify it.
            </p>
          )}
          {info.health === 'unavailable' && (
            <p className="font-semibold text-negative">
              Storage could not be verified safely. No files were changed.
            </p>
          )}
          {info.backup.state === 'verified' && (
            <p className="text-muted">
              Last-good JSON backup verified · {info.backup.deckCount} decks
            </p>
          )}
          {info.backup.state === 'invalid' && (
            <p className="text-negative">A backup file was detected but could not be verified.</p>
          )}
          <p className="text-xs leading-relaxed text-faint">
            This JSON backup protects the current workspace format. It is not yet the complete,
            asset-aware native-vault recovery system.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" type="button" onClick={() => void exportData()}>
          <Download className="h-4 w-4" />
          Export my research
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          Import
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importData(file);
          event.target.value = '';
        }}
      />

      <div className="border-t border-border pt-5">
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <h3 className="text-sm font-semibold text-content">Native vault readiness</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Check whether this workspace can be prepared for the future native vault. The check is
            local and read-only. It does not create a vault, approve a migration, or contact a
            provider.
          </p>
          <button
            className="btn-ghost mt-3 border border-border text-sm"
            type="button"
            disabled={busy || !info || info.health !== 'ready' || info.contentKind !== 'workspace'}
            onClick={() => void checkMigrationReadiness()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Check migration readiness
          </button>
          {readiness?.state === 'ready' && (
            <div
              role="status"
              className="mt-3 rounded-lg border border-positive/30 bg-positive/5 p-3 text-xs"
            >
              <p className="font-semibold text-content">
                Readiness check passed for {readiness.counts.decks} decks,{' '}
                {readiness.counts.companies} companies, and {readiness.counts.cards} cards.
              </p>
              <p className="mt-1 leading-relaxed text-muted">
                No files were copied, converted, replaced, or uploaded. This is not approval to
                switch storage; migration remains disabled in this build.
              </p>
            </div>
          )}
          {blockedReason && (
            <p role="alert" className="mt-3 text-xs text-negative">
              {blockedReason}
            </p>
          )}
        </div>
      </div>
      {message && (
        <p role="alert" className="text-sm text-negative">
          {message}
        </p>
      )}
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
          Your research is written to three places: this browser, an IndexedDB vault, and an
          automatic backup.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
        <span className="text-content">
          <span className="font-semibold tabular-nums">{Math.max(currentMarkets, 0)}</span> deck
          {currentMarkets === 1 ? '' : 's'} stored
        </span>
        <span className="text-muted tabular-nums">{sizeKb} KB</span>
        {backupMarkets > 0 && (
          <span className="text-muted">
            backup: <span className="tabular-nums">{backupMarkets}</span> deck
            {backupMarkets === 1 ? '' : 's'}
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
          <button type="button" className="btn-primary text-sm" onClick={restoreBackup}>
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
        <p className="mt-1 text-sm text-muted">Right now your research lives in this browser.</p>
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
  const communityDesktop = isCommunityDesktop();
  const [capDraft, setCapDraft] = useState(
    controls.monthlyCapUsd != null ? String(controls.monthlyCapUsd) : '',
  );

  const applyCap = () => {
    const n = Number(capDraft);
    setCostControls({
      monthlyCapUsd: capDraft.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n,
    });
  };

  const usd = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="space-y-6 pb-6">
      <div>
        <h2 className="font-display text-lg text-content">
          {communityDesktop ? 'Usage & limits' : 'Usage & billing'}
        </h2>
      </div>

      {lowPower && !communityDesktop && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Low power mode — your spending cap is reached. Autonomous research is paused.
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-2 p-4">
        {communityDesktop ? (
          <div
            role="note"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
          >
            <p className="font-semibold">Desktop usage is not metered here yet</p>
            <p className="mt-1 leading-relaxed">
              These estimates do not include provider calls made by the desktop research process.
              Check your provider's billing dashboard for actual usage.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-content">This month on your key</p>
              <p className="font-display text-2xl font-bold tabular-nums text-content">
                {usd(spend.estUsd)}
                <span className="ml-1 text-[11px] font-medium text-faint">est.</span>
              </p>
            </div>
            <div
              className={cn(
                'mt-3 grid gap-3 text-center',
                spend.image > 0 ? 'grid-cols-3' : 'grid-cols-2',
              )}
            >
              <div>
                <p className="font-display text-sm font-bold tabular-nums text-content">
                  {spend.grounded}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-muted">searches</p>
                <p className="text-[10px] tabular-nums text-faint">{usd(spend.estByKind.ground)}</p>
              </div>
              <div>
                <p className="font-display text-sm font-bold tabular-nums text-content">
                  {spend.structure}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-muted">extractions</p>
                <p className="text-[10px] tabular-nums text-faint">
                  {usd(spend.estByKind.structure)}
                </p>
              </div>
              {spend.image > 0 && (
                <div>
                  <p className="font-display text-sm font-bold tabular-nums text-content">
                    {spend.image}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-muted">past images</p>
                  <p className="text-[10px] tabular-nums text-faint">
                    {usd(spend.estByKind.image)}
                  </p>
                </div>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              Estimates from published list prices, counted locally. Today: {usage.total} of{' '}
              {DAILY_REQUEST_CAP} requests in your local safety budget (~{usage.decksLeft} more
              decks). Google quota and billing depend on your AI Studio account.
            </p>
          </>
        )}
      </div>

      {communityDesktop ? (
        <div
          role="note"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
        >
          <p className="font-semibold">A hard spending cap is not available in Desktop yet</p>
          <p className="mt-1 leading-relaxed">
            Starting live research requires an explicit action, but this build cannot enforce a
            provider-spend limit. Manage billing limits with your provider.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-content">Monthly spending cap</p>
            <p className="mt-0.5 text-xs text-muted">
              Hit the cap and the app scales back to low power mode.
            </p>
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
      )}
    </div>
  );
}

function PricingPanel() {
  const [oneTime, setOneTime] = useState(10);
  const TIERS = [
    {
      name: 'Starter',
      price: 19,
      blurb: 'Up to 10 decks a month with cited daily briefings.',
      highlight: false,
    },
    {
      name: 'Growth',
      price: 49,
      blurb: 'More room to run: 40 decks a month, everything in Starter, priority research lanes.',
      highlight: true,
    },
    {
      name: 'Max',
      price: 99,
      blurb: 'For teams living in the product: 150 decks a month and the full feature surface.',
      highlight: false,
    },
  ];
  return (
    <div className="space-y-6 pb-6">
      <div>
        <h2 className="font-display text-lg text-content">Pricing — three doors</h2>
        <p className="mt-1 text-sm text-muted">
          Research runs on your own Gemini key — we never see it. Pick how you want the app to
          arrive.
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
          Fully hosted on Google Cloud — no API key to manage, usage included up to your tier's
          monthly cap.
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
