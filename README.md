# Planify

A responsive, cross-platform calendar web app in Apple's Liquid Glass idiom, with
natural-language scheduling, Google sign-in, and cloud sync that keeps your phone
and your computer in step.

**There is no demo data.** No sample, seeded, or placeholder events exist anywhere
in the codebase. Every new account starts with a completely empty calendar, and
every event you see is one you created.

---

## Quick start

```bash
npm ci          # install (node_modules is not committed)
npm run dev     # API on :8787 + web on :5173
```

Open http://localhost:5173. With no credentials configured the app runs in
**on-device mode**: your calendar is stored in this browser's IndexedDB, fully
functional and offline-capable, but single-device. Sign in with
**Continue with a device account**.

Before the first run, note that `public/icons/*.png` **are** committed — the PWA
manifest references them unconditionally. If you change `icon-source.png`,
regenerate them with `npm run icons`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web together (`concurrently`) |
| `npm run dev:web` | Vite only, `0.0.0.0:5173` |
| `npm run dev:api` | Node API only, `0.0.0.0:8787` |
| `npm run build` | Typecheck, then `vite build` |
| `npm run preview` | Serve the production build on `:4173` |
| `npm start` | Run the API server alone |
| `npm run typecheck` | `tsc --noEmit` over app + config |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch mode |
| `npm run icons` | Rebuild the PWA icon set |

---

## Stack

Vite 6 · React 19 · TypeScript 5.7 (strict) · Tailwind 3.4 · date-fns 3 ·
`idb` · `@supabase/supabase-js` · `vite-plugin-pwa` · Vitest 5.

The backend is a dependency-free Node `http` server (`server/index.mjs`) that
Vite proxies at `/api`, so browser code never needs another origin.

## Architecture

```
src/
  components/      UI: calendar views, sheets, sidebar, nav, assistant, settings
  hooks/           viewport, theme, pointer-drag, calendar shell state
  lib/
    providers/     the data layer — see below
    dates.ts       timezone-safe date helpers (never toISOString().slice(0,10))
    recurrence.ts  RFC 5545 RRULE subset, expanded locally
    calendarEngine.ts  range resolution, occurrence layout, filtering, search
  nlp/             the on-device natural-language parser
  store/           AppStore — the single source of truth for app state
  views/           CalendarPage
server/index.mjs   AI + Google Calendar endpoints (holds every secret)
supabase/migrations/  schema, RLS policies, realtime, account deletion
```

### The provider layer

Everything data-shaped goes through a `DataProvider` interface
(`src/lib/providers/types.ts`). Two implementations exist:

- **`local.ts`** — IndexedDB. The default; no configuration needed.
- **`supabase.ts`** — Postgres + Google OAuth (PKCE) + realtime + an offline
  outbox that replays on reconnect.

`initProvider()` picks cloud mode when `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are both present, and falls back to local storage if the
cloud client fails to load, so a misconfigured deploy degrades instead of showing
a blank screen. `VITE_FORCE_LOCAL=true` forces device mode. The Supabase SDK is
imported **dynamically**, so on-device users never download it.

### Storage rules

- Timed events are absolute UTC ISO instants; all-day events are date-only
  `YYYY-MM-DD` in the event's own timezone with an **exclusive** end date
  (matching Google Calendar).
- Deletes are soft (`deleted: true`) in cloud mode so the removal propagates to
  other devices; local mode deletes outright.
- A monotonic `version` column drives last-write-wins merging.
- Editing one occurrence of a recurring series adds its date to `exceptions` and
  writes a standalone event; editing the series patches the parent.

### AI scheduling

Natural language is parsed **on device** (`src/nlp/`) — dates, times, durations,
locations, recurrence and reminders — with no network call and no key. The server
route is optional and only fills gaps the local parser flags as `missing`; it can
never write to your calendar directly.

Two rules are load-bearing:

1. **Nothing is saved without confirmation.** The assistant shows a card with the
   exact pending action, and only Confirm writes it.
2. **The parser never fabricates a field.** If it cannot resolve the day, it says
   so and asks, rather than silently defaulting to today.

Suggestions (free slots, conflicts, rescheduling) are computed from your *real*
existing events.

### Server API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness + which integrations are configured |
| `GET /api/ai/health` | Whether an LLM key is present |
| `POST /api/ai/parse` | Optional LLM gap-filling for a parsed instruction |
| `GET /api/gcal/authorize` | Start the Google Calendar OAuth flow |
| `GET /api/gcal/callback` | OAuth redirect target |
| `POST /api/gcal/sync` | Two-way sync (needs Google credentials) |
| `POST /api/gcal/disconnect` | Revoke and forget the link |

**No API key ever reaches the browser.** Only `VITE_`-prefixed variables are
exposed to the client, and the Supabase anon key is publishable by design —
authorisation is enforced by Row Level Security, not by key secrecy.

---

## Going live (cloud sync + Google sign-in)

1. Create a Supabase project.
2. Apply the schema — tables, RLS policies, realtime publication, the
   `delete_account()` RPC, and the new-user trigger:

   ```bash
   supabase db push     # or paste supabase/migrations/0001_init.sql into the SQL editor
   ```

3. In Google Cloud Console, create an OAuth client of type **Web application**
   and enable the Google Calendar API.
4. Copy `.env.example` to `.env.local` and fill in:

   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...      # publishable; RLS does the authorising
   GOOGLE_CLIENT_ID=...            # server only — never VITE_-prefixed
   GOOGLE_CLIENT_SECRET=...        # server only
   OPENAI_API_KEY=...              # optional; or ANTHROPIC_API_KEY
   ```

5. Restart `npm run dev`. The welcome screen promotes **Continue with Google** to
   the primary action automatically once a cloud backend is detected.

Sign-in requests identity scope only. The Google Calendar scope is requested
separately, and only if you opt in under Settings → Google Calendar. Google
passwords are never stored, and refresh tokens stay server-side.

Every table is RLS-scoped to `auth.uid() = user_id`. Deleting your account runs
`delete_account()`, which removes every row you own plus the `auth.users` record,
invalidating sessions on all devices.

---

## Design

Dark Liquid Glass is the default, with Light mode and follow-system. Backgrounds
run `#0A0A0C`–`#121214` — never pure black. Glass is applied to nav bars, tab
bars, floating buttons, modals, sheets and menus, but deliberately **not** to the
calendar grid or event details, which stay opaque enough to read.

Body text meets a 4.5:1 contrast minimum against its surface in both themes, and
small text is held to a stronger ratio. `prefers-reduced-motion` is honoured
throughout.

The layout is responsive across phone, tablet, laptop and desktop: a glass sidebar
on wide screens, a glass bottom tab bar on narrow ones, a floating glass **+**
button, and iOS/Android safe-area insets.

### Keyboard shortcuts

`T` today · `M` month · `W` week · `D` day · `A` agenda · `N` new event ·
`/` search · `←`/`→` step through dates · `?` show shortcuts

---

## Tests

```bash
npm test
```

92 tests across three files. Pure logic (recurrence expansion, the NLP parser)
runs in Node; the sign-in flow runs in jsdom against a fake IndexedDB, driving the
real UI through welcome → device sign-in → onboarding → calendar and asserting the
session survives a reload.

Those tests exist because of two real bugs they caught:

- **An infinite onboarding loop.** Finishing onboarding optimistically set
  `onboardingComplete`, then wrote the profile through a provider that rebuilt its
  session from the stale stored row and re-broadcast `false` — bouncing the user
  back to step 1 forever.
- **"Next Friday" booked the wrong week.** `resolveWeekday` returned the soonest
  future occurrence, so asking for "next Friday" on a Thursday created the event
  tomorrow.

Also covered: `INTERVAL` on weekly rules being ignored once the cursor drifted,
skipped months and leap days terminating a series instead of advancing it, and
`UNTIL` parsed as UTC midnight, which dropped the final day for anyone west of
Greenwich.

---

## Known limitations

- Google sign-in and cross-device sync require your own Supabase project and
  Google OAuth client; neither credential ships with this repo.
- Google Calendar sync returns `501` until Google credentials are configured.
- The LLM route is inert without an API key. This is by design — the on-device
  parser handles scheduling either way.
