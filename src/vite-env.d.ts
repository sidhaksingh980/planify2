/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="vite/client" />

/**
 * Environment surface.
 *
 * ONLY `VITE_`-prefixed values are visible to the browser. The Supabase *anon*
 * key is safe to expose (it is a public publishable key that is meaningless
 * without Row Level Security — and RLS is enforced in supabase/migrations).
 * Every real secret (LLM keys, Google Calendar refresh tokens, the Supabase
 * service role key) lives exclusively in `server/` and `supabase/`.
 */
interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable/anon key. Guarded by RLS. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Set to "false" to force local mode even when Supabase env vars exist. */
  readonly VITE_FORCE_LOCAL?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css';
