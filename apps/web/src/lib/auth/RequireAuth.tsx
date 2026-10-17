import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from './AuthContext';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { getAccessProfile, subscribeAccess, tryUnlock } from '@/lib/access';
import wordmark from '@/assets/wordmark.svg';
import { isCommunityDesktop } from '@/lib/settings/runtime';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, signInWithEmail } = useAuth();
  const [, force] = useState(0);
  useEffect(() => subscribeAccess(() => force((n) => n + 1)), []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  const [showCodeInput, setShowCodeInput] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setEmailLoading(true);
    setEmailError('');

    try {
      const user = await signInWithEmail(email, password);
      if (!user) {
        setEmailError('Invalid email or password.');
      }
    } catch (err: unknown) {
      const e = err as Error;
      setEmailError(e.message || 'Login failed');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleCodeSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await tryUnlock(code);
      if (!profile) {
        setError("That code didn't match. Codes are case-insensitive.");
        return;
      }
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something broke checking the code — try again.');
    } finally {
      setBusy(false);
    }
  };

  if (isCommunityDesktop() || import.meta.env.VITE_OPEN_ACCESS === 'true' || import.meta.env.MODE === 'test') return <>{children}</>;
  if (isLoading) return <FullPageLoader label="Checking your session…" />;
  if (isAuthenticated || getAccessProfile()) return <>{children}</>;

  return (
    <div className="grid min-h-screen place-items-center bg-bg px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <img src={wordmark} alt="" className="mx-auto h-12 w-12" />
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-content">
            Stratemark
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Living market-intelligence decks — researched, sourced, self-verifying.
          </p>
        </div>

        <div className="panel mt-6 p-5">
          {!showCodeInput ? (
            <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-4">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted">
                <Mail className="h-3.5 w-3.5" />
                Sign In
              </label>

              <div className="space-y-2.5">
                <div>
                  <label htmlFor="auth-email" className="sr-only">Email</label>
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="input w-full bg-body"
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="auth-password" className="sr-only">Password</label>
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="input w-full bg-body"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              {emailError && (
                <p className="text-center text-[12px] text-negative">{emailError}</p>
              )}

              <button
                type="submit"
                disabled={emailLoading || !email || !password}
                className="btn-primary w-full justify-center"
              >
                {emailLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign In / Register'
                )}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setShowCodeInput(true)}
                  className="text-[11px] text-muted underline transition-colors hover:text-content"
                >
                  Have an access code? Enter code
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => void handleCodeSubmit(e)} className="space-y-3">
              <label
                htmlFor="access-code"
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted"
              >
                <Lock className="h-3.5 w-3.5" />
                Access Code
              </label>
              <input
                id="access-code"
                className="input py-2.5 text-center font-display text-[15px] tracking-[0.15em]"
                placeholder="XXXX-XXXX-XX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                className="btn-primary w-full justify-center"
                disabled={busy || !code.trim()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {busy ? 'Checking…' : 'Enter'}
              </button>

              {error && <p className="text-center text-[12px] text-negative">{error}</p>}

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setShowCodeInput(false)}
                  className="text-[11px] text-muted underline transition-colors hover:text-content"
                >
                  Back to email login
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mx-auto mt-5 flex max-w-xs items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          Your research and API key stay in this browser.
        </p>
      </div>
    </div>
  );
}
