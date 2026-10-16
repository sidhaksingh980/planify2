/**
 * WelcomeScreen — the first-run experience.
 *
 * Dark Liquid Glass by default: a deep charcoal field, one soft aurora wash,
 * a glass card with a specular top edge, and a single dominant action.
 *
 * Sign-in is honest about capability:
 *   • With a cloud backend attached, "Continue with Google" starts the real
 *     Google OAuth PKCE flow (identity scope only — Calendar access is asked
 *     for later, separately, and only if the user opts in).
 *   • Without one, the Google button explains exactly what is missing and
 *     offers an on-device account so the app is usable immediately. No demo
 *     data is created either way; a new account starts empty.
 */
import { useState } from 'react';
import { cx } from '../../lib/utils';
import { useAppStore } from '../../store/AppStore';
import { Button, Spinner } from '../ui/Button';
import { Field, TextInput } from '../ui/Controls';
import { GoogleMark, Icon } from '../ui/Icon';
import { BrandMark } from '../Sidebar';

export interface WelcomeScreenProps {
  onContinueLocal: () => void;
}

export function WelcomeScreen({ onContinueLocal }: WelcomeScreenProps) {
  const { signInWithGoogle, signInLocally, authError, provider } = useAppStore();
  const cloud = provider?.id === 'cloud';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Without a cloud backend the Google button can never complete, so the
  // on-device form is open from the start rather than hidden behind a click.
  const [showLocal, setShowLocal] = useState(!cloud);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleGoogle = async () => {
    setBusy(true);
    setError(null);
    const res = await signInWithGoogle();
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Google sign-in did not complete.');
      if (!cloud) setShowLocal(true);
    }
  };

  const handleLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInLocally({ name, email });
      onContinueLocal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden px-4 py-8">
      {/* Ambient wash — low contrast so it never competes with the text. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 animate-breathe opacity-70"
        style={{ backgroundImage: 'var(--aurora)', backgroundSize: 'cover' }}
      />

      <div className="relative w-full max-w-[420px]">
        <div className="glass glass-strong animate-pop-in rounded-[26px] px-6 py-8 shadow-glass-lg sm:px-8">
          {/* Brand */}
          <div className="flex flex-col items-center text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center">
              <BrandMark size={54} />
            </span>
            <h1 className="font-display text-[27px] font-bold leading-tight tracking-[-0.03em] text-ink">
              Planify
            </h1>
            <p className="mt-2 max-w-[19rem] text-balance text-[14px] leading-relaxed text-ink2">
              A calm, glass calendar that schedules with you — and keeps every device in step.
            </p>
          </div>

          {/* Feature list */}
          <ul className="mt-6 space-y-2">
            {[
              { icon: 'sparkles' as const, text: 'Turn plain English into real events' },
              { icon: 'cloud' as const, text: 'Synced across your phone and computer' },
              { icon: 'shield' as const, text: 'Row-level security on everything you save' },
            ].map((f) => (
              <li key={f.text} className="flex items-center gap-2.5 text-[13px] text-ink2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/14 text-accent">
                  <Icon name={f.icon} size={14} weight={2} />
                </span>
                {f.text}
              </li>
            ))}
          </ul>

          {/* Errors */}
          {error || authError ? (
            <p
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-[13px] border border-danger/30 bg-danger/12 px-3 py-2.5 text-[12.5px] font-medium leading-snug text-danger"
            >
              <Icon name="alert" size={15} weight={2} className="mt-px shrink-0" />
              <span>{error ?? authError}</span>
            </p>
          ) : null}

          {/* Primary action.
              Google leads only when a cloud backend can actually complete the
              OAuth exchange — otherwise it is demoted below the path that
              works, so the first thing a user clicks is never a dead end. */}
          <div className="mt-6 space-y-2.5">
            {cloud ? (
              <button
                type="button"
                onClick={() => void handleGoogle()}
                disabled={busy}
                className={cx(
                  'pressable flex h-12 w-full items-center justify-center gap-3 rounded-[15px]',
                  'bg-[rgb(var(--c-raised))] text-[15px] font-semibold text-ink',
                  'border border-[rgb(var(--c-line)/var(--line-strong-alpha))]',
                  'shadow-[0_1px_2px_rgb(0_0_0/0.3),inset_0_1px_0_rgb(255_255_255/0.1)]',
                  'hover:bg-[rgb(var(--c-raised)/0.85)] disabled:opacity-60',
                )}
              >
                {busy ? <Spinner size={18} /> : <GoogleMark size={19} />}
                Continue with Google
              </button>
            ) : (
              <Button
                variant="glass"
                size="lg"
                block
                icon="device"
                onClick={() => setShowLocal((v) => !v)}
                aria-expanded={showLocal}
                disabled={busy}
              >
                {showLocal ? 'Hide device account' : 'Continue with a device account'}
              </Button>
            )}

            {!cloud ? (
              <button
                type="button"
                onClick={() => void handleGoogle()}
                disabled={busy}
                className={cx(
                  'pressable flex h-11 w-full items-center justify-center gap-2.5 rounded-[15px]',
                  'border border-[rgb(var(--c-line)/var(--line-alpha))] text-[13.5px] font-medium',
                  'text-ink2 hover:text-ink hover:bg-[rgb(var(--c-raised)/0.6)] disabled:opacity-60',
                )}
              >
                {busy ? <Spinner size={16} /> : <GoogleMark size={17} />}
                Continue with Google
              </button>
            ) : null}
          </div>

          {!cloud ? (
            <p className="mt-3 flex items-start gap-2 rounded-[13px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.6)] px-3 py-2.5 text-[11.5px] leading-snug text-ink3">
              <Icon name="info" size={13} weight={2} className="mt-px shrink-0 text-warn" />
              <span>
                Google sign-in is not available in this build: it needs a cloud backend
                (<code className="font-mono text-[11px] text-ink2">VITE_SUPABASE_URL</code> and{' '}
                <code className="font-mono text-[11px] text-ink2">VITE_SUPABASE_ANON_KEY</code>)
                plus a Google OAuth client. Use a device account to get in now.
              </span>
            </p>
          ) : null}

          {/* On-device sign-in */}
          {showLocal ? (
            <form onSubmit={(e) => void handleLocal(e)} className="mt-4 space-y-3">
              <div className="rounded-[15px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.7)] p-3">
                <p className="mb-3 flex items-start gap-2 text-[12px] leading-snug text-ink2">
                  <Icon name="info" size={14} weight={2} className="mt-px shrink-0 text-accent" />
                  A device account stores your calendar in this browser. It is real and permanent
                  here, but it will not appear on other devices until you connect a cloud database.
                </p>
                <div className="space-y-2.5">
                  <Field label="Your name" htmlFor="local-name" required>
                    <TextInput
                      id="local-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Name"
                      autoComplete="name"
                      data-autofocus
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Email" htmlFor="local-email" hint="Optional — used only to label this account.">
                    <TextInput
                      id="local-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      maxLength={160}
                    />
                  </Field>
                  <Button type="submit" variant="primary" size="lg" block loading={busy}>
                    Start with an empty calendar
                  </Button>
                </div>
              </div>
            </form>
          ) : null}

          <p className="mt-6 text-center text-[11px] leading-relaxed text-ink3">
            Identity only at sign-in. Google Calendar access is requested separately, and only if
            you choose to connect it.
            <br />
            We never store your Google password.
          </p>
        </div>

        <p className="mt-4 text-center text-[11.5px] text-ink3">
          {cloud ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="cloud" size={12} weight={2} />
              Connected to your cloud database
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="device" size={12} weight={2} />
              No cloud database configured — running on this device
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
