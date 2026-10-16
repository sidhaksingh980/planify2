/**
 * The assistant.
 *
 * Routing:
 *   1. The local NLP engine always runs first. It resolves dates, times,
 *      durations, recurrence, reminders, locations and conflicts
 *      deterministically and offline — no key, no network, no cost.
 *   2. If a server-side LLM is configured (`/api/ai/health` → enabled), its
 *      understanding is used to *fill gaps* the local parser could not resolve.
 *      The LLM never writes to the database: it can only propose, and every
 *      proposal goes through the same confirmation card.
 *
 * Invariant enforced here and in the UI: **nothing is created, changed or
 * deleted without an explicit user confirmation.**
 */
import {
  addDays,
  addMinutes,
  atTime,
  dayKey,
  differenceInMinutes,
  fmtMinutes,
  startOfDay,
} from '../lib/dates';
import { describeRecurrence, nextOccurrenceAfter } from '../lib/recurrence';
import { detectIntent, parseEventInstruction, type ParseContext } from './parseEvent';
import {
  adviseReschedule,
  explainSlot,
  findConflicts,
  findFreeSlots,
  suggestCategory,
  suggestFollowUps,
  type SlotRequest,
} from './suggest';
import { categoryLegend, dayPartWindow, detectSummaryRange, summarize } from './summarize';
import { CATEGORIES, getCategory } from '../types';
import type {
  CalEvent,
  ChatMessage,
  Occurrence,
  ProposedAction,
  ProposedEvent,
  TimeSlot,
  UserSettings,
} from '../types';

export interface AssistantContext {
  events: CalEvent[];
  settings: UserSettings;
  now: Date;
  /** The event the user last opened — makes "reschedule it" resolve. */
  focusEvent?: CalEvent | null;
  /** Recent conversation, newest last. */
  history: ChatMessage[];
}

export interface AssistantReply {
  content: string;
  action: ProposedAction | null;
  /** Quick-reply chips rendered under the message. */
  chips?: string[];
}

/* -------------------------------------------------------------------------- */
/* Optional LLM — server-side only, the key never reaches the browser          */
/* -------------------------------------------------------------------------- */

export interface LlmAvailability {
  enabled: boolean;
  model?: string;
  reason?: string;
}

let availabilityCache: LlmAvailability | null = null;

export async function llmAvailability(): Promise<LlmAvailability> {
  if (availabilityCache) return availabilityCache;
  try {
    const res = await fetch('/api/ai/health');
    availabilityCache = res.ok
      ? ((await res.json()) as LlmAvailability)
      : { enabled: false, reason: 'AI service unavailable' };
  } catch {
    availabilityCache = { enabled: false, reason: 'AI service not running' };
  }
  return availabilityCache;
}

export function resetLlmAvailability(): void {
  availabilityCache = null;
}

interface LlmProposal {
  title?: string;
  startISO?: string;
  endISO?: string;
  allDay?: boolean;
  location?: string;
  categoryId?: string;
  reminderMinutes?: number[];
  recurrence?: ProposedEvent['recurrence'];
  notes?: string;
}

async function askLlm(text: string, ctx: AssistantContext): Promise<LlmProposal | null> {
  const avail = await llmAvailability();
  if (!avail.enabled) return null;
  try {
    const res = await fetch('/api/ai/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        now: ctx.now.toISOString(),
        timezone: ctx.settings.timezone,
        // Only this user's own upcoming events, minimised.
        upcoming: ctx.events
          .filter((e) => !e.deleted)
          .slice(0, 20)
          .map((e) => ({
            title: e.title,
            start: e.startTime,
            end: e.endTime,
            allDay: e.allDay,
          })),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { proposal?: LlmProposal };
    return json.proposal ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function respond(text: string, ctx: AssistantContext): Promise<AssistantReply> {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { content: 'What would you like to do?', action: null };

  const parseCtx: ParseContext = {
    now: ctx.now,
    timezone: ctx.settings.timezone,
    defaultReminderMinutes: ctx.settings.defaultReminderMinutes,
    defaultCategoryId: ctx.settings.defaultCategoryId,
    focusEventId: ctx.focusEvent?.id ?? null,
    focusEventTitle: ctx.focusEvent?.title ?? null,
  };

  switch (detectIntent(trimmed)) {
    case 'summarise':
      return summariseReply(trimmed, ctx);
    case 'find_slots':
      return findSlotsReply(trimmed, ctx);
    case 'delete':
      return deleteReply(trimmed, ctx);
    case 'reschedule':
    case 'move':
      return rescheduleReply(trimmed, ctx, parseCtx);
    case 'create':
      return createReply(trimmed, ctx, parseCtx);
    default:
      return helpReply(trimmed, ctx);
  }
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

async function createReply(
  text: string,
  ctx: AssistantContext,
  parseCtx: ParseContext,
): Promise<AssistantReply> {
  const parsed = parseEventInstruction(text, parseCtx);
  let event = parsed.action?.event;

  if (!event) {
    return {
      content:
        "I couldn't find an event in that. Try “Add lunch with Maya next Tuesday at 1 PM for 90 minutes.”",
      action: null,
      chips: ['What am I doing this week?', 'Find me 30 free minutes tomorrow'],
    };
  }

  if (parsed.missing.length) {
    const llm = await askLlm(text, ctx);
    if (llm) event = mergeLlm(event, llm, parsed.missing);
  }

  const start = event.allDay
    ? new Date(`${event.startTime.slice(0, 10)}T00:00:00`)
    : new Date(event.startTime);
  const end = event.allDay
    ? new Date(`${event.endTime.slice(0, 10)}T00:00:00`)
    : new Date(event.endTime);

  const stillMissing: string[] = [];
  if (!event.title || event.title === 'Untitled event') stillMissing.push('a title');
  if (parsed.missing.includes('date')) stillMissing.push('a date');

  if (stillMissing.length) {
    return {
      content: `I can add that — I just need ${listOr(stillMissing)}. ${
        stillMissing.includes('a title') ? 'What should it be called?' : 'Which day?'
      }`,
      action: {
        kind: 'create_event',
        summary: parsed.action!.summary,
        event,
        missing: stillMissing,
        warnings: parsed.warnings,
        confidence: parsed.confidence,
      },
      chips: stillMissing.includes('a date')
        ? ['Tomorrow', 'Next Monday', 'In 3 days']
        : undefined,
    };
  }

  const conflicts = event.allDay ? [] : findConflicts(ctx.events, start, end);
  const cat = getCategory(event.categoryId);

  const lines: string[] = [
    "Here's what I'll add. Nothing is saved until you confirm:",
    '',
    parsed.action!.summary,
    '',
    `Category: ${cat.name}${event.recurrence ? ` · ${describeRecurrence(event.recurrence, start)}` : ''}`,
  ];

  for (const w of parsed.warnings) lines.push(`• ${w}`);

  if (conflicts.length) {
    lines.push('', `⚠️ This clashes with ${conflicts.length} existing event${conflicts.length > 1 ? 's' : ''}:`);
    for (const c of conflicts.slice(0, 3)) {
      lines.push(`• “${c.occurrence.event.title}” — ${fmtMinutes(c.overlapMinutes)} overlap`);
    }
    const alts = findFreeSlots(ctx.events, {
      durationMinutes: Math.max(15, differenceInMinutes(end, start)),
      from: startOfDay(start),
      to: addDays(startOfDay(start), 7),
      dayStartHour: ctx.settings.dayStartHour,
      dayEndHour: Math.min(23, ctx.settings.dayStartHour + 10),
      workdaysOnly: false,
      count: 3,
    }).map((s) => explainSlot(s, ctx.events, ctx.settings.dayStartHour, ctx.settings.dayStartHour + 10));
    if (alts.length) {
      lines.push('', 'Free instead:');
      for (const s of alts) lines.push(`• ${slotLabel(s)}`);
    }
  }

  const followUps = suggestFollowUps({
    title: event.title,
    description: event.description,
    location: event.location,
  });
  if (followUps.length && !conflicts.length) {
    lines.push('', `You might also want to: ${followUps.join(' · ')}`);
  }

  return {
    content: lines.join('\n'),
    action: {
      kind: 'create_event',
      summary: parsed.action!.summary,
      event,
      warnings: parsed.warnings,
      confidence: parsed.confidence,
    },
    chips: conflicts.length
      ? ['Find me a free slot instead', 'Add it anyway']
      : ['Add it', 'Change the time'],
  };
}

function mergeLlm(event: ProposedEvent, llm: LlmProposal, missing: string[]): ProposedEvent {
  const out: ProposedEvent = { ...event };
  if (missing.includes('title') && llm.title) out.title = llm.title;
  if (missing.includes('date') && llm.startISO) {
    out.startTime = llm.startISO;
    if (llm.endISO) out.endTime = llm.endISO;
    out.allDay = !!llm.allDay;
  }
  if (llm.location && !out.location) out.location = llm.location;
  if (llm.categoryId && CATEGORIES.some((c) => c.id === llm.categoryId)) out.categoryId = llm.categoryId;
  if (llm.reminderMinutes?.length && !out.reminders.length) out.reminders = llm.reminderMinutes;
  if (llm.notes && !out.description) out.description = llm.notes;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Summaries                                                                   */
/* -------------------------------------------------------------------------- */

function summariseReply(text: string, ctx: AssistantContext): AssistantReply {
  const scope = detectSummaryRange(text) ?? 'upcoming';
  const result = summarize(ctx.events, scope, {
    now: ctx.now,
    timeFormat: ctx.settings.timeFormat,
    firstDayOfWeek: ctx.settings.firstDayOfWeek,
    dayStartHour: ctx.settings.dayStartHour,
    dayEndHour: Math.min(23, ctx.settings.dayStartHour + 10),
  });

  if (!result.occurrences.length) {
    return {
      content: `**${result.heading}: nothing scheduled.** Your calendar is empty for that range.\n\nWant me to find some free time, or add something?`,
      action: { kind: 'summary', summary: `${result.heading}: no events` },
      chips: ['Find me free time this week', 'Add an event'],
    };
  }

  const lines = [result.body];

  if (scope !== 'today') {
    const perDay = new Map<string, number>();
    for (const o of result.occurrences) {
      const k = dayKey(o.start);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
    if (busiest && busiest[1] >= 3) {
      const d = new Date(`${busiest[0]}T12:00:00`);
      lines.push(
        '',
        `${d.toLocaleDateString(undefined, { weekday: 'long' })} is your heaviest day with ${busiest[1]} events.`,
      );
    }
  }

  const next = result.occurrences.find((o) => o.allDay || o.start.getTime() > ctx.now.getTime());
  if (next && !next.allDay) {
    const mins = differenceInMinutes(next.start, ctx.now);
    if (mins > 0 && mins <= 180) lines.push('', `Up next: “${next.event.title}” in ${fmtMinutes(mins)}.`);
  }

  return {
    content: lines.join('\n'),
    action: {
      kind: 'summary',
      summary: `${result.heading}: ${result.occurrences.length} events`,
    },
    chips: ['Find me a free slot', "What's on tomorrow?", 'Add an event'],
  };
}

/* -------------------------------------------------------------------------- */
/* Free slots                                                                  */
/* -------------------------------------------------------------------------- */

function findSlotsReply(text: string, ctx: AssistantContext): AssistantReply {
  const duration = parseWantedDuration(text) ?? 30;
  const window = dayPartWindow(text, ctx.now);
  const from = window ? window.from : addMinutes(startOfDay(ctx.now), ctx.now.getHours() * 60 + 15);
  const to = window ? window.to : addDays(startOfDay(ctx.now), 7);
  const workdaysOnly = !/\bweekend\b|\bsaturday\b|\bsunday\b|\bany day\b/i.test(text);

  const dayEnd = Math.min(23, ctx.settings.dayStartHour + 11);

  let slots: TimeSlot[];
  try {
    slots = findFreeSlots(ctx.events, {
      durationMinutes: duration,
      from: new Date(Math.max(from.getTime(), ctx.now.getTime())),
      to,
      dayStartHour: ctx.settings.dayStartHour,
      dayEndHour: dayEnd,
      workdaysOnly,
      count: 5,
    }).map((s) => explainSlot(s, ctx.events, ctx.settings.dayStartHour, dayEnd));
  } catch (err) {
    console.error('[planify] slot search failed', err);
    return { content: 'I hit a problem searching your calendar. Please try again.', action: null };
  }

  const hasEvents = ctx.events.some((e) => !e.deleted);

  if (!slots.length) {
    return {
      content: `I couldn't find ${duration} free minutes in that window${
        workdaysOnly ? ' on a weekday' : ''
      }. ${hasEvents ? 'Your calendar is full there.' : ''}\n\nWant me to widen the search?`,
      action: { kind: 'suggest_slots', summary: 'No free slots found', slots: [] },
      chips: ['Search the whole week', 'Try 15 minutes instead', 'Include weekends'],
    };
  }

  const lead = hasEvents
    ? `Here are ${slots.length} openings for ${duration} minutes, based on your real schedule:`
    : `Your calendar is empty, so any time works. Here are ${duration}-minute slots I'd suggest:`;

  const lines = [lead, '', ...slots.map((s, i) => `${i + 1}. ${slotLabel(s)} — ${s.reason}`)];

  const top = slots[0];
  const proposal: ProposedEvent = {
    title: '',
    description: '',
    startTime: top.startTime,
    endTime: top.endTime,
    allDay: false,
    timezone: ctx.settings.timezone,
    location: '',
    categoryId: ctx.settings.defaultCategoryId,
    reminders: [ctx.settings.defaultReminderMinutes].filter((m) => m > 0),
    recurrence: null,
    exceptions: [],
  };

  return {
    content: lines.join('\n'),
    action: {
      kind: 'suggest_slots',
      summary: `${slots.length} free ${duration}-minute slots`,
      slots,
      event: proposal,
      missing: ['title'],
      confidence: 0.8,
    },
    chips: slots.slice(0, 3).map((s) => `Book ${slotLabel(s)}`),
  };
}

function parseWantedDuration(text: string): number | null {
  const t = text.toLowerCase();
  const m = /\b(\d{1,3}|half an)\s*(?:-\s*)?(minute|minutes|min|mins|hour|hours|hr|hrs)\b/.exec(t);
  if (m) {
    const n = m[1] === 'half an' ? 0.5 : Number(m[1]) || 1;
    return /hour|hr/.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  }
  if (/\b(quick|short)\s+(chat|call|sync|catch ?up)\b/.test(t)) return 15;
  return null;
}

export function slotLabel(s: TimeSlot): string {
  const start = new Date(s.startTime);
  const end = new Date(s.endTime);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: d.getMinutes() ? '2-digit' : undefined,
    });
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${fmt(start)}–${fmt(end)}`;
}

/* -------------------------------------------------------------------------- */
/* Delete                                                                      */
/* -------------------------------------------------------------------------- */

function deleteReply(text: string, ctx: AssistantContext): AssistantReply {
  const target = findReferencedEvent(text, ctx);
  if (!target) {
    return {
      content:
        'Which event should I remove? Tell me the name, or open it in the calendar first and say “delete this”.',
      action: null,
      chips: ['What am I doing this week?'],
    };
  }
  const occ = nextOccurrenceAfter(target, ctx.now);
  const when = occ ? describeOccurrence(occ) : 'an unknown time';

  return {
    content: `I'll delete “${target.title}” (${when})${
      target.recurrence
        ? ` — including the whole repeating series (${describeRecurrence(target.recurrence)})`
        : ''
    }. This can't be undone.`,
    action: {
      kind: 'delete_event',
      summary: `Delete “${target.title}”`,
      eventId: target.id,
      confidence: 0.9,
      warnings: target.recurrence ? ['This removes every future occurrence.'] : [],
    },
    chips: ['Delete it', 'Cancel'],
  };
}

/* -------------------------------------------------------------------------- */
/* Reschedule                                                                  */
/* -------------------------------------------------------------------------- */

function rescheduleReply(
  text: string,
  ctx: AssistantContext,
  parseCtx: ParseContext,
): AssistantReply {
  const target = findReferencedEvent(text, ctx);
  if (!target) {
    return {
      content:
        'Which event do you want to move? Name it, or open it in the calendar and say “move this to Thursday at 2pm”.',
      action: null,
      chips: ['What am I doing this week?'],
    };
  }

  const occ = nextOccurrenceAfter(target, ctx.now);
  if (!occ) {
    return { content: `“${target.title}” has no upcoming occurrence to move.`, action: null };
  }

  const parsed = parseEventInstruction(text, parseCtx);
  const proposal = parsed.action?.event;

  if (!proposal) {
    // No new time stated. If it currently conflicts, offer a fix.
    const conflicts = findConflicts(ctx.events, occ.start, occ.end, target.id);
    const other = conflicts.find((c) => c.occurrence.seriesId !== target.id);
    if (other) {
      const advice = adviseReschedule(ctx.events, occ, other.occurrence, {
        durationMinutes: Math.max(15, differenceInMinutes(occ.end, occ.start)),
        dayStartHour: ctx.settings.dayStartHour,
        dayEndHour: Math.min(23, ctx.settings.dayStartHour + 10),
        workdaysOnly: false,
        count: 4,
      });
      return {
        content: `${advice.conflictSummary}\n\nFree options:\n${advice.slots
          .map((s, i) => `${i + 1}. ${slotLabel(s)}`)
          .join('\n')}`,
        action: {
          kind: 'reschedule_event',
          summary: advice.conflictSummary,
          eventId: advice.moveEventId,
          slots: advice.slots,
          confidence: 0.7,
        },
        chips: advice.slots.slice(0, 3).map((s) => `Move it to ${slotLabel(s)}`),
      };
    }
    return {
      content: `When should I move “${target.title}” to? It's currently ${describeOccurrence(occ)}.`,
      action: null,
      chips: ['Tomorrow, same time', 'Next Monday at 10am', 'Find me a free slot'],
    };
  }

  const durationMs = occ.end.getTime() - occ.start.getTime();
  const newStart = proposal.allDay
    ? atTime(new Date(`${proposal.startTime.slice(0, 10)}T00:00:00`), occ.start.getHours(), occ.start.getMinutes())
    : new Date(proposal.startTime);
  const newEnd = new Date(newStart.getTime() + durationMs);
  const conflicts = findConflicts(ctx.events, newStart, newEnd, target.id);

  const lines = [
    `Move “${target.title}”:`,
    `• From  ${describeOccurrence(occ)}`,
    `• To    ${describeRange(newStart, newEnd)}`,
  ];
  if (target.recurrence) {
    lines.push(
      '',
      `This repeats (${describeRecurrence(target.recurrence)}). Moving it updates the whole series — in the event dialog you can choose “this occurrence only”.`,
    );
  }
  if (conflicts.length) {
    lines.push(
      '',
      `⚠️ The new time clashes with ${conflicts.map((c) => `“${c.occurrence.event.title}”`).join(', ')}.`,
    );
  }
  for (const w of parsed.warnings) lines.push(`• ${w}`);
  lines.push('', 'Confirm and I’ll save it — it syncs to your other devices straight away.');

  return {
    content: lines.join('\n'),
    action: {
      kind: 'reschedule_event',
      summary: `Move “${target.title}” to ${describeRange(newStart, newEnd)}`,
      eventId: target.id,
      patch: {
        startTime: target.allDay ? dayKey(newStart) : newStart.toISOString(),
        endTime: target.allDay ? dayKey(newEnd) : newEnd.toISOString(),
      },
      warnings: parsed.warnings,
      confidence: parsed.confidence,
    },
    chips: conflicts.length ? ['Find a free slot instead', 'Move it anyway'] : ['Move it', 'Cancel'],
  };
}

function describeOccurrence(o: Occurrence): string {
  if (o.allDay) {
    return `all day on ${o.start.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })}`;
  }
  return o.start.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function describeRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: d.getMinutes() ? '2-digit' : undefined,
    });
  return `${start.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })}, ${fmt(start)}–${fmt(end)}`;
}

/* -------------------------------------------------------------------------- */
/* Reference resolution                                                        */
/* -------------------------------------------------------------------------- */

/** Resolve "it", "that meeting", "the dentist" against real stored events. */
export function findReferencedEvent(text: string, ctx: AssistantContext): CalEvent | null {
  const t = text.toLowerCase();
  const live = ctx.events.filter((e) => !e.deleted);
  if (!live.length) return ctx.focusEvent ?? null;

  // 1. Anaphora + the event open in the UI.
  if (/\b(this|it|that one|the same one)\b/.test(t) && ctx.focusEvent) {
    return live.find((e) => e.id === ctx.focusEvent!.id) ?? ctx.focusEvent;
  }

  // 2. Quoted title.
  const quoted = /[“"']([^”"']{2,80})[”"']/.exec(text);
  if (quoted) {
    const q = quoted[1].toLowerCase();
    const exact = live.find((e) => e.title.toLowerCase() === q);
    if (exact) return exact;
    const partial = live.find((e) => e.title.toLowerCase().includes(q));
    if (partial) return partial;
  }

  // 3. Word overlap against stored titles; longest common tokens win.
  const words = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);
  let best: { event: CalEvent; score: number } | null = null;
  for (const e of live) {
    const titleWords = e.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    let score = 0;
    for (const w of titleWords) if (words.includes(w)) score += w.length;
    if (score >= 4 && (!best || score > best.score)) best = { event: e, score };
  }
  if (best) return best.event;

  return ctx.focusEvent ?? null;
}

/* -------------------------------------------------------------------------- */
/* Help / fallback                                                             */
/* -------------------------------------------------------------------------- */

async function helpReply(text: string, ctx: AssistantContext): Promise<AssistantReply> {
  const t = text.toLowerCase();
  const live = ctx.events.filter((e) => !e.deleted);

  if (/^(hello|hi|hey|yo|good (morning|afternoon|evening))\b/.test(t)) {
    const upcoming = live
      .map((e) => nextOccurrenceAfter(e, ctx.now))
      .filter((o): o is Occurrence => !!o && o.start.getTime() >= ctx.now.getTime() - 3_600_000)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

    const state = upcoming
      ? `Next up: “${upcoming.event.title}” ${describeOccurrence(upcoming)}.`
      : live.length
        ? 'You have events on file but nothing coming up right now.'
        : 'Your calendar is empty — a clean slate.';

    return {
      content: `Hi! ${state}\n\nI can:\n• Turn plain English into events — “Add lunch with Maya next Tuesday at 1 PM for 90 minutes”\n• Find free time — “find me 30 minutes tomorrow afternoon”\n• Summarise — “what’s on this week?”\n• Resolve clashes — “reschedule the dentist”\n• Suggest categories, reminders and follow-ups\n\nNothing is saved until you confirm it.`,
      action: null,
      chips: ['What am I doing this week?', 'Find me free time tomorrow', 'Add an event'],
    };
  }

  if (/\b(help|what can you do|capabilities|commands|how do you work)\b/.test(t)) {
    return {
      content: `Here's what I do:\n\n**Create** — “Schedule a dentist appointment next Friday morning and remind me the day before.”\n**Find time** — “When am I free for a 45-minute call this week?”\n**Summarise** — “Recap my week.” / “What’s on today?”\n**Reschedule** — “Move the design review to Thursday at 3pm.”\n**Delete** — “Cancel the standup.”\n\nI parse dates, times, durations, locations, recurrence and reminders from plain English and check them against your real events for clashes. Categories available: ${categoryLegend()}.`,
      action: null,
      chips: ['What’s on today?', 'Find me a free slot'],
    };
  }

  // Verb-less input that still looks like an event → try the create path.
  const parsed = parseEventInstruction(text, {
    now: ctx.now,
    timezone: ctx.settings.timezone,
    defaultReminderMinutes: ctx.settings.defaultReminderMinutes,
    defaultCategoryId: ctx.settings.defaultCategoryId,
  });
  if (parsed.action?.event && parsed.titleGuess && parsed.confidence >= 0.5) {
    return createReply(text, ctx, {
      now: ctx.now,
      timezone: ctx.settings.timezone,
      defaultReminderMinutes: ctx.settings.defaultReminderMinutes,
      defaultCategoryId: ctx.settings.defaultCategoryId,
    });
  }

  return {
    content: `I didn't follow that. Try:\n\n• “Add lunch with Maya next Tuesday at 1 PM for 90 minutes”\n• “Find me 30 free minutes tomorrow”\n• “What's on this week?”\n• “Move the dentist appointment to Friday”`,
    action: null,
    chips: ["What's on this week?", 'Find me free time'],
  };
}

/* -------------------------------------------------------------------------- */
/* Applying a confirmed action                                                 */
/* -------------------------------------------------------------------------- */

export function buildEventFromProposal(
  proposal: ProposedEvent,
  userId: string,
  existing?: CalEvent,
): CalEvent {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? cryptoId('evt'),
    userId,
    title: proposal.title.trim() || 'Untitled event',
    description: proposal.description || existing?.description || '',
    startTime: proposal.startTime,
    endTime: proposal.endTime,
    allDay: proposal.allDay,
    timezone: proposal.timezone,
    location: proposal.location ?? '',
    categoryId:
      proposal.categoryId && CATEGORIES.some((c) => c.id === proposal.categoryId)
        ? proposal.categoryId
        : (existing?.categoryId ?? suggestCategory(proposal.title, proposal.location ?? '')),
    reminders: proposal.reminders ?? [],
    recurrence: proposal.recurrence ?? null,
    exceptions: proposal.exceptions ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deleted: false,
    googleEventId: existing?.googleEventId ?? null,
    googleCalendarId: existing?.googleCalendarId ?? null,
    version: (existing?.version ?? 0) + 1,
  };
}

export function cryptoId(prefix = ''): string {
  const c = globalThis.crypto as Crypto | undefined;
  const uuid = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/** A sane default for a tapped time slot in the day/week grid. */
export function defaultDraft(day: Date, hour: number, settings: UserSettings): ProposedEvent {
  const start = atTime(day, hour, 0);
  return {
    title: '',
    description: '',
    startTime: start.toISOString(),
    endTime: addMinutes(start, 60).toISOString(),
    allDay: false,
    timezone: settings.timezone,
    location: '',
    categoryId: settings.defaultCategoryId,
    reminders: [settings.defaultReminderMinutes].filter((m) => m > 0),
    recurrence: null,
    exceptions: [],
  };
}

/** A blank all-day draft for a tapped month cell. */
export function allDayDraft(day: Date, settings: UserSettings): ProposedEvent {
  const start = startOfDay(day);
  return {
    title: '',
    description: '',
    startTime: dayKey(start),
    endTime: dayKey(addDays(start, 1)),
    allDay: true,
    timezone: settings.timezone,
    location: '',
    categoryId: settings.defaultCategoryId,
    reminders: [],
    recurrence: null,
    exceptions: [],
  };
}

export type { SlotRequest };

function listOr(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
