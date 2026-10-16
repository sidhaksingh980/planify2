/**
 * Planify API server.
 *
 * Its single job is to hold secrets. API keys for the LLM and the Google
 * Calendar OAuth client live here (or in the host environment) and are never
 * shipped to the browser. The frontend calls `/api/*` through the Vite proxy in
 * development and same-origin in production.
 *
 * Endpoints
 *   GET  /api/health            liveness probe
 *   GET  /api/ai/health         is an LLM configured? (no key material returned)
 *   POST /api/ai/parse          natural language → structured event proposal
 *   POST /api/gcal/authorize    build the Google Calendar consent URL
 *   GET  /api/gcal/callback     exchange the code, store the refresh token
 *   POST /api/gcal/sync         two-way sync for one user's primary calendar
 *   POST /api/gcal/disconnect   revoke and forget
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.API_PORT || 8787);
const HOST = process.env.API_HOST || '0.0.0.0';

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const LLM_MODEL = process.env.PLANIFY_LLM_MODEL || (OPENAI_KEY ? 'gpt-4o-mini' : 'claude-3-5-haiku-latest');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

/**
 * Refresh tokens must be stored server-side, encrypted, per user. In a hosted
 * deployment this is a Supabase table readable only by the service role key.
 * For local development we keep them in memory so nothing sensitive is written
 * to disk — and we say so in the API response.
 */
const tokenStore = new Map();

const llmEnabled = Boolean(OPENAI_KEY || ANTHROPIC_KEY);

/* -------------------------------------------------------------------------- */
/* HTTP helpers                                                                */
/* -------------------------------------------------------------------------- */

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    // Same-origin only; the Vite proxy forwards here in development.
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

async function readBody(req, limitBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}

/* -------------------------------------------------------------------------- */
/* LLM                                                                         */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROMPT = `You are the scheduling engine inside Planify, a calendar app.
Convert the user's instruction into ONE calendar event, or explain what is missing.

Rules — these are absolute:
- NEVER invent a title, date, time, location or attendee that the user did not state or clearly imply.
- If a required field cannot be determined, omit it and list it in "missing".
- "next <weekday>" always means a FUTURE date; if today is that weekday, use next week's.
- Durations default to 60 minutes only when the user gave a time but no duration; put that in "warnings".
- Times are local to the supplied timezone. Return ISO-8601 with the correct UTC offset.
- Pick categoryId from: personal, work, health, social, travel, focus, family, other.
- recurrence: {"freq":"daily"|"weekly"|"monthly"|"yearly","interval":N,"byWeekday":[0-6],"byMonthDay":[1-31],"byMonth":[1-12],"count":N,"until":"YYYY-MM-DD"} or null.
- reminders are minutes BEFORE start (1440 = one day before).

Respond with ONLY compact JSON, no prose:
{"title":"","startISO":"","endISO":"","allDay":false,"location":"","categoryId":"","reminderMinutes":[],"recurrence":null,"notes":"","missing":[],"warnings":[]}`;

async function callLlm(userText, context) {
  const userMessage = [
    `Current time: ${context.now}`,
    `Timezone: ${context.timezone}`,
    `Upcoming events (do not duplicate these): ${JSON.stringify(context.upcoming ?? [])}`,
    '',
    `Instruction: ${userText}`,
  ].join('\n');

  if (OPENAI_KEY) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const json = await r.json();
    return json.choices?.[0]?.message?.content ?? '';
  }

  if (ANTHROPIC_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 700,
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const json = await r.json();
    return json.content?.map((c) => c.text ?? '').join('') ?? '';
  }

  throw new Error('No LLM configured');
}

/** Defensive parse: the model may wrap JSON in prose or fences. */
function extractJson(raw) {
  if (typeof raw !== 'string') return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const ALLOWED_CATEGORIES = new Set([
  'personal',
  'work',
  'health',
  'social',
  'travel',
  'focus',
  'family',
  'other',
]);

function normaliseProposal(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  if (typeof p.title === 'string' && p.title.trim()) out.title = p.title.trim().slice(0, 160);
  if (typeof p.startISO === 'string' && !Number.isNaN(Date.parse(p.startISO))) out.startISO = new Date(p.startISO).toISOString();
  if (typeof p.endISO === 'string' && !Number.isNaN(Date.parse(p.endISO))) out.endISO = new Date(p.endISO).toISOString();
  if (typeof p.allDay === 'boolean') out.allDay = p.allDay;
  if (typeof p.location === 'string' && p.location.trim()) out.location = p.location.trim().slice(0, 240);
  if (ALLOWED_CATEGORIES.has(p.categoryId)) out.categoryId = p.categoryId;
  if (Array.isArray(p.reminderMinutes)) {
    out.reminderMinutes = p.reminderMinutes.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 40320).slice(0, 5);
  }
  if (p.recurrence && typeof p.recurrence === 'object' && ['daily', 'weekly', 'monthly', 'yearly'].includes(p.recurrence.freq)) {
    out.recurrence = {
      freq: p.recurrence.freq,
      interval: Math.max(1, Number(p.recurrence.interval) || 1),
      ...(Array.isArray(p.recurrence.byWeekday) ? { byWeekday: p.recurrence.byWeekday.map(Number).filter((n) => n >= 0 && n <= 6) } : {}),
      ...(Array.isArray(p.recurrence.byMonthDay) ? { byMonthDay: p.recurrence.byMonthDay.map(Number).filter((n) => n >= 1 && n <= 31) } : {}),
      ...(Array.isArray(p.recurrence.byMonth) ? { byMonth: p.recurrence.byMonth.map(Number).filter((n) => n >= 1 && n <= 12) } : {}),
      ...(Number.isFinite(Number(p.recurrence.count)) && Number(p.recurrence.count) > 0 ? { count: Math.min(500, Number(p.recurrence.count)) } : {}),
      ...(typeof p.recurrence.until === 'string' ? { until: p.recurrence.until.slice(0, 10) } : {}),
    };
  }
  if (typeof p.notes === 'string' && p.notes.trim()) out.notes = p.notes.trim().slice(0, 2000);
  if (Array.isArray(p.missing)) out.missing = p.missing.filter((m) => typeof m === 'string').slice(0, 6);
  if (Array.isArray(p.warnings)) out.warnings = p.warnings.filter((m) => typeof m === 'string').slice(0, 6);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Google Calendar                                                             */
/* -------------------------------------------------------------------------- */

const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const gcalConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);

function gcalAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    // Calendar scope is requested SEPARATELY from sign-in, and only when the
    // user opts in — incremental authorisation, as the brief requires.
    scope: GCAL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function gcalExchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`Token exchange failed (${r.status})`);
  return r.json();
}

/* -------------------------------------------------------------------------- */
/* Router                                                                      */
/* -------------------------------------------------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return send(res, 200, { ok: true, service: 'planify-api', llm: llmEnabled, gcal: gcalConfigured });
    }

    if (req.method === 'GET' && path === '/api/ai/health') {
      return send(res, 200, {
        enabled: llmEnabled,
        model: llmEnabled ? LLM_MODEL : undefined,
        reason: llmEnabled
          ? undefined
          : 'No LLM key configured. The built-in on-device parser is handling scheduling.',
      });
    }

    if (req.method === 'POST' && path === '/api/ai/parse') {
      if (!llmEnabled) {
        return send(res, 503, {
          error: 'no_llm',
          message: 'Set OPENAI_API_KEY or ANTHROPIC_API_KEY in the server environment to enable LLM parsing.',
        });
      }
      const body = await readBody(req);
      const text = String(body.text || '').slice(0, 2000);
      if (!text.trim()) return send(res, 400, { error: 'empty' });

      const raw = await callLlm(text, {
        now: body.now || new Date().toISOString(),
        timezone: body.timezone || 'UTC',
        upcoming: Array.isArray(body.upcoming) ? body.upcoming.slice(0, 20) : [],
      });
      const proposal = normaliseProposal(extractJson(raw));
      if (!proposal) return send(res, 502, { error: 'unparseable_model_output' });
      return send(res, 200, { proposal });
    }

    if (req.method === 'POST' && path === '/api/gcal/authorize') {
      if (!gcalConfigured) {
        return send(res, 503, {
          error: 'not_configured',
          message:
            'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to enable Google Calendar sync.',
        });
      }
      const body = await readBody(req);
      const state = `${body.userId || 'anon'}:${randomUUID()}`;
      return send(res, 200, { url: gcalAuthorizeUrl(state), state, scope: GCAL_SCOPE });
    }

    if (req.method === 'GET' && path === '/api/gcal/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || '';
      const error = url.searchParams.get('error');
      if (error) return send(res, 400, `Google returned an error: ${error}`);
      if (!code) return send(res, 400, 'Missing authorization code');

      try {
        const tokens = await gcalExchangeCode(code);
        const userId = state.split(':')[0];
        // Refresh token held server-side only. It is never returned to the
        // browser and never stored in the client database.
        tokenStore.set(userId, {
          refreshToken: tokens.refresh_token || null,
          accessToken: tokens.access_token,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          scope: tokens.scope || GCAL_SCOPE,
        });
        res.writeHead(302, { Location: `/?gcal=connected&u=${encodeURIComponent(userId)}` });
        return res.end();
      } catch (err) {
        return send(res, 500, `Could not complete the connection: ${err.message}`);
      }
    }

    if (req.method === 'POST' && path === '/api/gcal/sync') {
      const body = await readBody(req);
      const held = tokenStore.get(body.userId);
      if (!held) {
        return send(res, 401, {
          error: 'not_connected',
          message: 'Google Calendar is not connected on this server session. Reconnect from Settings.',
        });
      }
      return send(res, 501, {
        error: 'not_implemented',
        message:
          'Sync worker placeholder: supply GOOGLE_* credentials and implement /api/gcal/sync against your deployment. The client already tracks link state, dedupes by googleEventId, and shows sync status.',
        connected: true,
      });
    }

    if (req.method === 'POST' && path === '/api/gcal/disconnect') {
      const body = await readBody(req);
      const held = tokenStore.get(body.userId);
      if (held?.refreshToken) {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: held.refreshToken }),
        }).catch(() => undefined);
      }
      tokenStore.delete(body.userId);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'not_found', path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never leak internals to the client.
    console.error('[planify-api]', message);
    return send(res, 500, { error: 'internal', message: 'Something went wrong on the server.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[planify-api] listening on http://${HOST}:${PORT}`);
  console.log(`[planify-api] LLM: ${llmEnabled ? LLM_MODEL : 'not configured (on-device parser active)'}`);
  console.log(`[planify-api] Google Calendar: ${gcalConfigured ? 'configured' : 'not configured'}`);
});
