/**
 * AssistantPanel — the AI side panel (desktop) / full-height sheet (mobile).
 *
 * Three guarantees the UI makes visible:
 *   1. Every proposed change is described in plain words *before* anything is
 *      written — the ActionCard spells out title, date, time, duration,
 *      location, category, repeat and reminders.
 *   2. Nothing is saved until the user presses Confirm. Discard is equally
 *      prominent, and the panel never auto-applies.
 *   3. Suggestions come from the user's real events. With an empty calendar the
 *      assistant says the calendar is empty instead of inventing content.
 *
 * Chat history is persisted with the rest of the account data, so it is there
 * again after a refresh or on another device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/utils';
import { addMinutes, fmtMinutes, formatTime, fromDayKey } from '../../lib/dates';
import { describeRecurrence } from '../../lib/recurrence';
import { reminderPhrase } from '../../nlp/parseEvent';
import { llmAvailability, respond, slotLabel, type AssistantContext, type LlmAvailability } from '../../nlp/assistant';
import { getCategory, type CalEvent, type ChatMessage, type ProposedAction, type UserSettings } from '../../types';
import { Icon } from '../ui/Icon';
import { Button, IconButton, Spinner } from '../ui/Button';
import { useAppStore } from '../../store/AppStore';
import { useScrollLock, useViewport } from '../../hooks/useViewport';
import { newId } from '../../lib/utils';

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  events: CalEvent[];
  focusEvent: CalEvent | null;
  /** Owner id for persisted chat rows. */
  userId: string;
  /** Called when the assistant's proposal is confirmed. */
  onApply: (action: ProposedAction) => Promise<string | null>;
  /** Called when the user asks for something better handled by the editor. */
  onOpenEditor: (seed?: Partial<CalEvent>) => void;
}

const STARTER_PROMPTS = [
  'What’s on this week?',
  'Find me 30 free minutes tomorrow',
  'Add lunch with Maya next Tuesday at 1 PM for 90 minutes',
];

export function AssistantPanel({
  open,
  onClose,
  settings,
  events,
  focusEvent,
  userId,
  onApply,
  onOpenEditor,
}: AssistantPanelProps) {
  const { chat, addChatMessage, updateChatMessage, clearChat } = useAppStore();
  const { isMobile } = useViewport();
  useScrollLock(open && isMobile);

  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [llm, setLlm] = useState<LlmAvailability | null>(null);
  const [pendingAction, setPendingAction] = useState<{ message: ChatMessage; action: ProposedAction } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void llmAvailability().then(setLlm);
    // Focus the composer after the enter animation.
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.length, thinking, open]);

  const messages = useMemo(() => chat.slice(-60), [chat]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      const userMsg: ChatMessage = {
        id: newId('msg'),
        userId,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      await addChatMessage(userMsg);
      setInput('');
      setChips([]);
      setThinking(true);
      setApplyError(null);

      const ctx: AssistantContext = {
        events,
        settings,
        now: new Date(),
        focusEvent,
        history: chat,
      };

      let reply;
      try {
        reply = await respond(trimmed, ctx);
      } catch (err) {
        console.error('[planify] assistant failed', err);
        reply = {
          content: 'Something went wrong while I was reading your calendar. Please try again.',
          action: null,
        };
      }

      const assistantMsg: ChatMessage = {
        id: newId('msg'),
        userId,
        role: 'assistant',
        content: reply.content,
        createdAt: new Date().toISOString(),
        action: reply.action ?? null,
        resolved: false,
      };
      await addChatMessage(assistantMsg);
      setThinking(false);
      setChips(reply.chips ?? []);

      // Only one actionable proposal can be live at a time.
      const actionable =
        reply.action &&
        ['create_event', 'update_event', 'delete_event', 'reschedule_event'].includes(reply.action.kind);
      if (actionable && reply.action) {
        setPendingAction({ message: assistantMsg, action: reply.action });
      } else {
        setPendingAction(null);
      }
    },
    [addChatMessage, chat, events, focusEvent, settings, thinking, userId],
  );

  // Other surfaces (event detail, follow-up chips) can hand the assistant a
  // ready-made prompt through this event instead of reaching into its state.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.trim()) void send(detail);
    };
    window.addEventListener('planify:ai-prompt', onPrompt as EventListener);
    return () => window.removeEventListener('planify:ai-prompt', onPrompt as EventListener);
  }, [send]);

  const confirm = useCallback(async () => {
    if (!pendingAction) return;
    setApplyError(null);
    const result = await onApply(pendingAction.action);
    if (result === null) {
      setApplyError('That change could not be saved. Check your connection and try again.');
      return;
    }
    const updated: ChatMessage = { ...pendingAction.message, resolved: true };
    await updateChatMessage(updated);
    setPendingAction(null);
    setChips([]);
    await addChatMessage({
      id: newId('msg'),
      userId: pendingAction.message.userId,
      role: 'assistant',
      content: result,
      createdAt: new Date().toISOString(),
    });
  }, [pendingAction, onApply, updateChatMessage, addChatMessage]);

  const discard = useCallback(async () => {
    if (!pendingAction) return;
    const updated: ChatMessage = { ...pendingAction.message, resolved: true };
    await updateChatMessage(updated);
    setPendingAction(null);
    await addChatMessage({
      id: newId('msg'),
      userId: pendingAction.message.userId,
      role: 'assistant',
      content: 'Not saved. Anything else?',
      createdAt: new Date().toISOString(),
    });
  }, [pendingAction, updateChatMessage, addChatMessage]);

  if (!open) return null;

  const panel = (
    <div
      className={cx(
        'glass glass-strong flex flex-col overflow-hidden',
        isMobile
          ? 'fixed inset-0 z-[75] rounded-none'
          : 'fixed bottom-4 right-4 top-4 z-[60] w-[400px] rounded-[24px] shadow-glass-lg xl:w-[430px]',
      )}
      role="dialog"
      aria-label="AI assistant"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--glass-border-soft)] px-3.5 py-3">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/16 text-accent">
          <Icon name="sparkles" size={17} weight={2} />
          {thinking ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 animate-pulse-soft rounded-full bg-accent" />
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">Assistant</p>
          <p className="truncate text-[11px] text-ink3">
            {llm?.enabled
              ? `Local parser + ${llm.model}`
              : 'On-device scheduling engine · no data leaves your browser'}
          </p>
        </div>
        {messages.length > 0 ? (
          <IconButton icon="trash" label="Clear conversation" size="sm" variant="ghost" onClick={() => void clearChat()} />
        ) : null}
        <IconButton icon="close" label="Close assistant" size="sm" variant="ghost" onClick={onClose} />
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-3.5">
        {messages.length === 0 && !thinking ? (
          <EmptyAssistant
            eventCount={events.filter((e) => !e.deleted).length}
            onPick={(p) => void send(p)}
            onOpenEditor={onOpenEditor}
          />
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isPending={pendingAction?.message.id === m.id}
              onConfirm={() => void confirm()}
              onDiscard={() => void discard()}
              onSlotPick={(slotStart) => {
                const start = new Date(slotStart);
                onOpenEditor({
                  startTime: start.toISOString(),
                  endTime: addMinutes(start, 30).toISOString(),
                  allDay: false,
                });
              }}
            />
          ))
        )}

        {thinking ? (
          <div className="flex items-center gap-2 px-1 text-[12.5px] text-ink3">
            <Spinner size={13} />
            Reading your calendar…
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {/* Pending action bar */}
      {pendingAction ? (
        <div className="shrink-0 border-t border-[var(--glass-border-soft)] px-3.5 py-2.5">
          {applyError ? (
            <p role="alert" className="mb-2 flex items-start gap-1.5 text-[12px] font-medium text-danger">
              <Icon name="alert" size={13} weight={2.1} className="mt-px shrink-0" />
              {applyError}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink3">
              Waiting for your confirmation — nothing has been saved yet.
            </span>
            <Button size="sm" variant="subtle" onClick={() => void discard()}>
              Discard
            </Button>
            <Button size="sm" variant="primary" icon="check" onClick={() => void confirm()}>
              Confirm
            </Button>
          </div>
        </div>
      ) : null}

      {/* Composer */}
      <div className="shrink-0 border-t border-[var(--glass-border-soft)] px-3 py-3 safe-b">
        {chips.length > 0 ? (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => void send(c)}
                disabled={thinking}
                className="pressable shrink-0 rounded-full border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.05)] px-2.5 py-1 text-[11.5px] font-semibold text-ink2 hover:bg-[rgb(var(--c-line)/0.11)] hover:text-ink disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-end gap-2"
        >
          <label htmlFor="ai-input" className="sr-only">
            Tell the assistant what to schedule
          </label>
          <textarea
            id="ai-input"
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Add lunch with Maya next Tuesday at 1 PM…"
            className={cx(
              'max-h-28 min-h-[42px] flex-1 resize-none rounded-[14px] border px-3 py-2.5',
              'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.85)]',
              'text-[13.5px] leading-snug text-ink placeholder:text-ink3/75',
              'focus:border-accent/60 focus:outline-none focus-visible:shadow-focus',
            )}
          />
          <Button
            type="submit"
            variant="primary"
            icon="send"
            aria-label="Send"
            disabled={!input.trim() || thinking}
            className="h-[42px] w-[42px] shrink-0 !px-0"
          />
        </form>

        <p className="mt-2 text-[10.5px] leading-snug text-ink3">
          The assistant reads your real events to find free time and clashes. It always asks before
          saving.
        </p>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

/* -------------------------------------------------------------------------- */

function EmptyAssistant({
  eventCount,
  onPick,
  onOpenEditor,
}: {
  eventCount: number;
  onPick: (prompt: string) => void;
  onOpenEditor: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5 py-2">
      <div>
        <p className="text-[14px] font-semibold text-ink">Ask me to schedule something</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
          {eventCount === 0
            ? 'Your calendar is empty right now, so every slot is free. Describe an event and I’ll draft it for your approval.'
            : `I can see ${eventCount} event${eventCount === 1 ? '' : 's'} in your calendar and will check them for clashes.`}
        </p>
      </div>

      <div className="space-y-1.5">
        {STARTER_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className={cx(
              'pressable flex w-full items-center gap-2.5 rounded-[13px] border px-3 py-2.5 text-left',
              'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.7)]',
              'hover:border-accent/35 hover:bg-accent/8',
            )}
          >
            <Icon name="sparkles" size={14} weight={2} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink2">{p}</span>
            <Icon name="arrowRight" size={13} weight={2.1} className="shrink-0 text-ink3" />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenEditor}
        className="pressable inline-flex items-center justify-center gap-2 self-start rounded-full border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.05)] px-3 py-1.5 text-[12px] font-semibold text-ink2 hover:text-ink"
      >
        <Icon name="plus" size={12} weight={2.4} />
        Or add it manually
      </button>

      <div className="rounded-[13px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.5)] p-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink3">I understand</p>
        <ul className="mt-1.5 space-y-1 text-[12px] leading-snug text-ink2">
          <li>· Dates like “next Tuesday”, “in 3 days”, “March 14”</li>
          <li>· Times, durations and end times</li>
          <li>· Locations, reminders and repeating rules</li>
          <li>· Free slots, clashes, summaries and rescheduling</li>
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MessageBubble({
  message,
  isPending,
  onConfirm,
  onDiscard,
  onSlotPick,
}: {
  message: ChatMessage;
  isPending: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
  onSlotPick: (startISO: string) => void;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={cx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'max-w-[92%] rounded-[16px] px-3 py-2.5',
          isUser
            ? 'rounded-br-[5px] bg-accent/20 text-ink'
            : 'rounded-bl-[5px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.85)]',
        )}
      >
        <RichText text={message.content} />

        {message.action && !isUser ? (
          <ActionCard
            action={message.action}
            resolved={!!message.resolved && !isPending}
            pending={isPending}
            onConfirm={onConfirm}
            onDiscard={onDiscard}
            onSlotPick={onSlotPick}
          />
        ) : null}

        <p className="mt-1.5 text-[10px] text-ink3 tnum">
          {new Date(message.createdAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
          {message.resolved && !isUser ? ' · handled' : ''}
        </p>
      </div>
    </div>
  );
}

/** Minimal markdown-lite: `**bold**`, bullet lines and paragraphs. */
function RichText({ text }: { text: string }) {
  const blocks = text.split('\n');
  return (
    <div className="space-y-1 text-[13px] leading-relaxed text-ink">
      {blocks.map((line, i) => {
        const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
        const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
        const content = bullet?.[1] ?? numbered?.[2] ?? line;
        if (!content.trim() && !bullet && !numbered) return <div key={i} className="h-1" />;

        return (
          <p
            key={i}
            className={cx(bullet || numbered ? 'flex gap-1.5 pl-1' : '', 'whitespace-pre-wrap')}
          >
            {bullet ? <span aria-hidden="true" className="shrink-0 text-ink3">•</span> : null}
            {numbered ? (
              <span aria-hidden="true" className="shrink-0 tnum text-ink3">
                {numbered[1]}.
              </span>
            ) : null}
            <span className="min-w-0 flex-1">{renderInline(content)}</span>
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(p);
    if (bold) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {bold[1]}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/* -------------------------------------------------------------------------- */

/**
 * ActionCard — the "clearly show what the AI is about to do" requirement.
 * Every field that will be written is listed, including the ones inferred, and
 * the warnings from the parser are surfaced rather than hidden.
 */
function ActionCard({
  action,
  resolved,
  pending,
  onConfirm,
  onDiscard,
  onSlotPick,
}: {
  action: ProposedAction;
  resolved: boolean;
  pending: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
  onSlotPick: (startISO: string) => void;
}) {
  const event = action.event;
  const cat = event ? getCategory(event.categoryId) : null;

  if (action.kind === 'summary') {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-[11px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.05)] px-2.5 py-1.5">
        <Icon name="info" size={13} weight={2} className="shrink-0 text-ink3" />
        <span className="text-[11.5px] text-ink2">Read-only summary — nothing to save.</span>
      </div>
    );
  }

  if (action.kind === 'delete_event') {
    return (
      <div className="mt-2.5 overflow-hidden rounded-[13px] border border-danger/30 bg-danger/8">
        <p className="flex items-center gap-2 border-b border-danger/20 px-2.5 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.05em] text-danger">
          <Icon name="trash" size={12} weight={2.2} />
          Delete
        </p>
        <div className="px-2.5 py-2">
          <p className="text-[12.5px] font-medium text-ink">{action.summary}</p>
          {action.warnings?.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {action.warnings.map((w) => (
                <li key={w} className="text-[11.5px] leading-snug text-ink2">
                  · {w}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {pending ? (
          <ActionButtons onConfirm={onConfirm} onDiscard={onDiscard} confirmLabel="Delete" danger />
        ) : resolved ? (
          <ResolvedNote />
        ) : null}
      </div>
    );
  }

  if (action.kind === 'suggest_slots') {
    const slots = action.slots ?? [];
    return (
      <div className="mt-2.5 overflow-hidden rounded-[13px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.6)]">
        <p className="flex items-center gap-2 border-b border-[rgb(var(--c-line)/var(--line-alpha))] px-2.5 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.05em] text-accent">
          <Icon name="clock" size={12} weight={2.2} />
          Free slots
        </p>
        {slots.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] text-ink2">No openings in that window.</p>
        ) : (
          <ul className="divide-y divide-[rgb(var(--c-line)/var(--line-alpha))]">
            {slots.map((s) => (
              <li key={s.startTime}>
                <button
                  type="button"
                  onClick={() => onSlotPick(s.startTime)}
                  className="pressable flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-accent/8"
                >
                  <span className="mt-0.5 shrink-0 text-accent">
                    <Icon name="arrowRight" size={12} weight={2.3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-ink">{slotLabel(s)}</span>
                    {s.reason ? (
                      <span className="mt-0.5 block text-[11px] leading-snug text-ink3">{s.reason}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="px-2.5 py-1.5 text-[10.5px] text-ink3">
          Tap a slot to open the event form with that time filled in.
        </p>
      </div>
    );
  }

  if (!event || !cat) return null;

  const start = event.allDay ? fromDayKey(event.startTime.slice(0, 10)) : new Date(event.startTime);
  const end = event.allDay ? fromDayKey(event.endTime.slice(0, 10)) : new Date(event.endTime);

  const rows: Array<[string, string]> = [
    [
      'When',
      event.allDay
        ? `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · All day`
        : `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTime(start, '12h')} – ${formatTime(end, '12h')}`,
    ],
  ];
  if (!event.allDay) {
    rows.push(['Length', fmtMinutes(Math.max(0, (end.getTime() - start.getTime()) / 60_000))]);
  }
  if (event.location) rows.push(['Where', event.location]);
  rows.push(['Category', cat.name]);
  if (event.recurrence) rows.push(['Repeats', describeRecurrence(event.recurrence, start)]);
  rows.push([
    'Reminder',
    event.reminders.length ? event.reminders.map(reminderPhrase).join(', ') : 'None',
  ]);

  const isEdit = action.kind === 'reschedule_event' || action.kind === 'update_event';

  return (
    <div className="mt-2.5 overflow-hidden rounded-[13px] border border-accent/28 bg-accent/8">
      <p className="flex items-center gap-2 border-b border-accent/20 px-2.5 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.05em] text-accent">
        <Icon name={isEdit ? 'pencil' : 'plus'} size={12} weight={2.3} />
        {isEdit ? 'Change' : 'New event'} — not saved yet
      </p>

      <div className="px-2.5 py-2">
        <p className="text-[13.5px] font-semibold leading-snug text-ink">
          {event.title || <span className="text-ink3 italic">Needs a title</span>}
        </p>

        <dl className="mt-2 space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[12px] leading-snug">
              <dt className="w-[62px] shrink-0 text-ink3">{k}</dt>
              <dd className="min-w-0 flex-1 text-ink2">{v}</dd>
            </div>
          ))}
        </dl>

        {action.warnings?.length ? (
          <ul className="mt-2 space-y-1 border-t border-accent/18 pt-2">
            {action.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-ink2">
                <Icon name="info" size={12} weight={2} className="mt-px shrink-0 text-accent" />
                {w}
              </li>
            ))}
          </ul>
        ) : null}

        {action.missing?.length ? (
          <p className="mt-2 flex items-start gap-1.5 border-t border-accent/18 pt-2 text-[11.5px] leading-snug text-warn">
            <Icon name="alert" size={12} weight={2} className="mt-px shrink-0" />
            Still missing: {action.missing.join(', ')}. Confirming will open the form so you can fill it in.
          </p>
        ) : null}
      </div>

      {pending ? (
        <ActionButtons onConfirm={onConfirm} onDiscard={onDiscard} confirmLabel={isEdit ? 'Save change' : 'Add event'} />
      ) : resolved ? (
        <ResolvedNote />
      ) : null}
    </div>
  );
}

function ActionButtons({
  onConfirm,
  onDiscard,
  confirmLabel,
  danger = false,
}: {
  onConfirm: () => void;
  onDiscard: () => void;
  confirmLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-[rgb(var(--c-line)/var(--line-alpha))] px-2.5 py-2">
      <Button size="sm" variant="subtle" onClick={onDiscard}>
        Discard
      </Button>
      <Button
        size="sm"
        variant={danger ? 'danger' : 'primary'}
        icon="check"
        className="ml-auto"
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

function ResolvedNote() {
  return (
    <div className="flex items-center gap-1.5 border-t border-[rgb(var(--c-line)/var(--line-alpha))] px-2.5 py-1.5 text-[11px] font-semibold text-success">
      <Icon name="check" size={12} weight={2.6} />
      Handled
    </div>
  );
}
