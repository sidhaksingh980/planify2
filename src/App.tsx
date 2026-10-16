/**
 * Planify — application root.
 *
 * Boot sequence:
 *   1. Initialise the data provider (cloud when Supabase credentials exist,
 *      otherwise the on-device IndexedDB store).
 *   2. No session → WelcomeScreen.
 *   3. Session but onboarding not done → Onboarding.
 *   4. Otherwise → CalendarPage.
 *
 * The theme mode is lifted here so the ThemeProvider can wrap every screen,
 * including the welcome and onboarding flows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppStoreProvider, useAppStore } from './store/AppStore';
import { ThemeProvider } from './components/ThemeProvider';
import { WelcomeScreen } from './components/auth/WelcomeScreen';
import { Onboarding } from './components/onboarding/Onboarding';
import { CalendarPage } from './views/CalendarPage';
import { Spinner } from './components/ui/Button';
import { BrandMark } from './components/Sidebar';
import { DEFAULT_SETTINGS, type ThemeMode, type UserSettings } from './types';
import { readStore, writeStore } from './lib/utils';

const HIDDEN_CATEGORIES_KEY = 'planify:hiddenCategories:v1';

export function App() {
  return (
    <AppStoreProvider>
      <Root />
    </AppStoreProvider>
  );
}

function Root() {
  const {
    ready,
    user,
    authLoading,
    settings,
    settingsLoaded,
    updateSettings,
    completeOnboarding,
    provider,
  } = useAppStore();

  // Theme mode is mirrored into local storage so index.html can apply it before
  // first paint, avoiding a light-mode flash on a dark-mode reload.
  const [bootTheme, setBootTheme] = useState<ThemeMode>(() => {
    const stored = readStore<{ themeMode?: ThemeMode }>('planify:settings:v1', {});
    return stored.themeMode ?? DEFAULT_SETTINGS.themeMode;
  });

  useEffect(() => {
    if (settingsLoaded) setBootTheme(settings.themeMode);
  }, [settingsLoaded, settings.themeMode]);

  useEffect(() => {
    writeStore('planify:settings:v1', { themeMode: bootTheme });
  }, [bootTheme]);

  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<string[]>(() =>
    readStore<string[]>(HIDDEN_CATEGORIES_KEY, []),
  );

  useEffect(() => {
    writeStore(HIDDEN_CATEGORIES_KEY, hiddenCategoryIds);
  }, [hiddenCategoryIds]);

  const toggleCategory = useCallback((id: string) => {
    setHiddenCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Honour an OS-level "reduce motion" preference until the user overrides it.
  const effectiveSettings = useMemo<UserSettings>(() => {
    const prefersReduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      ...(settingsLoaded ? settings : DEFAULT_SETTINGS),
      reduceMotion: settingsLoaded ? settings.reduceMotion : prefersReduced,
    };
  }, [settings, settingsLoaded]);

  const handleThemeChange = useCallback(
    (mode: ThemeMode) => {
      setBootTheme(mode);
      if (user) void updateSettings({ themeMode: mode });
    },
    [updateSettings, user],
  );

  const handleOnboardingComplete = useCallback(
    async (next: UserSettings) => {
      // Complete onboarding first: it is the transition the user is waiting on.
      // Persisting the flag through the provider is what makes it stick, so
      // there is no second, racy write to storage here.
      await completeOnboarding();
      setBootTheme(next.themeMode);
      await updateSettings(next);
    },
    [completeOnboarding, updateSettings],
  );

  return (
    <ThemeProvider mode={bootTheme} onModeChange={handleThemeChange}>
      <div className="relative z-10 min-h-[100dvh]">
        {!ready || authLoading ? (
          <BootSplash />
        ) : !user ? (
          <WelcomeScreen onContinueLocal={() => undefined} />
        ) : !user.onboardingComplete ? (
          <Onboarding
            user={user}
            settings={effectiveSettings}
            onComplete={(next) => void handleOnboardingComplete(next)}
          />
        ) : (
          <CalendarPage
            user={user}
            settings={effectiveSettings}
            onOpenSettings={() => setSettingsOpen(true)}
            settingsOpen={settingsOpen}
            setSettingsOpen={setSettingsOpen}
            hiddenCategoryIds={hiddenCategoryIds}
            onToggleCategory={toggleCategory}
          />
        )}
      </div>
      {/* Provider identity is surfaced in Settings → Data & sync. */}
      <span className="sr-only" aria-live="polite">
        {provider?.label ?? ''}
      </span>
    </ThemeProvider>
  );
}

/**
 * Boot splash. Shown only while the provider resolves — typically one frame
 * with a warm cache, longer on a cold network. Never shows sample data.
 */
function BootSplash() {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-4 px-6">
      <div className="animate-pop-in">
        <BrandMark size={56} />
      </div>
      <p className="font-display text-[17px] font-bold tracking-[-0.02em] text-ink">Planify</p>
      <span className="flex items-center gap-2 text-[12.5px] text-ink3">
        <Spinner size={13} />
        Loading your calendar…
      </span>
    </div>
  );
}
