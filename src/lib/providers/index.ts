/**
 * Provider selection.
 *
 * Cloud mode wins whenever valid Supabase credentials are present, unless the
 * developer forces local mode with `VITE_FORCE_LOCAL=true`.
 *
 * The Supabase SDK is imported *dynamically*. It is several hundred kilobytes of
 * realtime/postgres/auth machinery that on-device users would otherwise download
 * for nothing, so it is only fetched when credentials actually exist.
 */
import { createLocalProvider } from './local';
import type { DataProvider } from './types';

let instance: DataProvider | null = null;
let initPromise: Promise<DataProvider> | null = null;

/** Read the env without importing the Supabase module. */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const forced = (import.meta.env.VITE_FORCE_LOCAL ?? '').toLowerCase();
  if (forced === 'true' || forced === '1') return null;

  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  if (!/^https:\/\/.+/i.test(url)) {
    console.warn('[planify] VITE_SUPABASE_URL must be an https:// URL — ignoring.');
    return null;
  }
  return { url, anonKey };
}

/** True when the app will run against a cloud database. */
export function isCloudConfigured(): boolean {
  return supabaseConfig() !== null;
}

/**
 * Resolve the active provider. Idempotent: repeated calls return the same
 * instance, and the Supabase chunk is fetched at most once.
 */
export async function getProvider(): Promise<DataProvider> {
  if (instance) return instance;

  const config = supabaseConfig();
  if (!config) {
    instance = createLocalProvider();
    return instance;
  }

  try {
    const { createCloudProvider } = await import('./supabase');
    instance = createCloudProvider(config.url, config.anonKey);
  } catch (err) {
    // A failed cloud boot must not brick the app — fall back to device storage
    // and tell the user through the status badge rather than a blank screen.
    console.error('[planify] cloud provider failed to load, using device storage', err);
    instance = createLocalProvider();
  }
  return instance;
}

/** Initialise the resolved provider exactly once. */
export async function initProvider(): Promise<DataProvider> {
  if (!initPromise) {
    initPromise = (async () => {
      const provider = await getProvider();
      try {
        await provider.init();
      } catch (err) {
        console.error('[planify] provider init failed, falling back to device storage', err);
        const fallback = createLocalProvider();
        await fallback.init();
        instance = fallback;
      }
      return instance ?? provider;
    })();
  }
  return initPromise;
}

export type { DataProvider, AuthSession, Subscription } from './types';
export { mergeEvent, eventFromRow, eventToRow } from './types';
