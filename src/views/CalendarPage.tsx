/**
 * CalendarPage — the signed-in app shell.
 *
 * Layout by breakpoint:
 *   desktop / laptop → glass sidebar (268px) + toolbar + grid
 *   tablet           → compact toolbar + grid, no sidebar
 *   phone            → toolbar + grid + floating glass bottom nav
 *
 * The grid sits on an opaque surface; only the chrome around it is glass, which
 * is what keeps event text and hairlines crisp at every size.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx, downloadJSON } from '../lib/utils';
import {
  addDays,
  dayKey,
  formatMonthTitle,
  formatRangeTitle,
  fromDayKey,
  startOfDay,
} from '../lib/dates';
import { isFilterActive } from '../lib/calendarEngine';
import { useCalendarShell } from '../hooks/useCalendarShell';
import { useNow, useViewport } from '../hooks/useViewport';
import { useAppStore } from '../store/AppStore';
import { useTheme } from '../hooks/useTheme';
import { defaultDraft, slotLabel } from '../nlp/assistant';
import {
  type CalEvent,
  type DataStatus,
  type Occurrence,
  type ProposedAction,
  type UserProfile,
  type UserSettings,
} from '../types';
import { TopBar } from '../components/TopBar';
import { Sidebar } from '../components/Sidebar';
import { BottomNav, type MobileTab } from '../components/BottomNav';
import { Fab, AiFab } from '../components/Fab';
import { Toolbar } from '../components/calendar/Toolbar';
import { CalendarSurface } from '../components/calendar/CalendarSurface';
import { EventSheet } from '../components/calendar/EventSheet';
import { EventDetail } from '../components/calendar/EventDetail';
import { SearchPanel } from '../components/calendar/SearchPanel';
import { AssistantPanel } from '../components/ai/AssistantPanel';
import { SettingsSheet } from '../components/settings/SettingsSheet';
import { ProfileMenu } from '../components/ProfileMenu';
import { EmptyState, ErrorState } from '../components/ui/Controls';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';

export interface CalendarPageProps {
  user: UserProfile;
  settings: UserSettings;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  hiddenCategoryIds: string[];
  onToggleCategory: (id: string) => void;
}

export function CalendarPage({
  user,
  settings,
  settingsOpen,
  setSettingsOpen,
  hiddenCategoryIds,
  onToggleCategory,
}: CalendarPageProps) {
  const store = useAppStore();
  const { resolved } = useTheme();
  const { isMobile, isDesktop } = useViewport();
  const now = useNow(30_000);

  const shell = useCalendarShell(settings);
  const {
    view,
    setView,
    anchor,
    goToday,
    step,
    selectedDay,
    selectDay,
    range,
    visibleEvents,
    occurrences,
    filters,
    setFilters,
    clearFilters,
    searchOpen,
    setSearchOpen,
    editor,
    openEditor,
    closeEditor,
    detail,
    openDetail,
    closeDetail,
    aiOpen,
    setAiOpen,
  } = shell;

  const [tab, setTab] = useState<MobileTab>('calendar');
  const [focusEvent, setFocusEvent] = useState<CalEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const profileRef = useRef<HTMLButtonElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const totalEvents = useMemo(() => store.events.filter((e) => !e.deleted).length, [store.events]);

  /* --- ephemeral toast ---------------------------------------------------- */
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2600);
  }, []);

  /* --- keyboard shortcuts -------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 't':
        case 'T':
          e.preventDefault();
          goToday();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          setView('month');
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          setView('week');
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          setView('day');
          break;
        case 'a':
        case 'A':
          e.preventDefault();
          setView('agenda');
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          openCreate(selectedDay, 9);
          break;
        case '/':
          e.preventDefault();
          setSearchOpen(true);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          step(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          step(1);
          break;
        case '?':
          e.preventDefault();
          showToast('Shortcuts: T today · M/W/D/A views · N new · / search · ← → navigate');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToday, setView, step, selectedDay, setSearchOpen]);

  /* --- create helpers ------------------------------------------------------ */
  const openCreate = useCallback(
    (day: Date, hour = 9) => {
      const draft = defaultDraft(startOfDay(day), hour, settings);
      openEditor({ event: null, draft });
    },
    [openEditor, settings],
  );

  const handleCreateAt = useCallback(
    (start: Date, end: Date) => {
      openEditor({
        event: null,
        draft: {
          ...defaultDraft(startOfDay(start), start.getHours(), settings),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          allDay: false,
        },
      });
    },
    [openEditor, settings],
  );

  const handleCreateOn = useCallback(
    (day: Date) => {
      // In month view a tap on a day means "all day" unless the user is in a
      // time-grid view, where the tapped hour is known.
      if (view === 'month' || view === 'agenda') {
        openEditor({
          event: null,
          draft: {
            ...defaultDraft(startOfDay(day), 9, settings),
            allDay: true,
            startTime: dayKey(day),
            endTime: dayKey(addDays(startOfDay(day), 1)),
            reminders: [],
          },
        });
      } else {
        openCreate(day, settings.dayStartHour + 2);
      }
    },
    [view, openEditor, openCreate, settings],
  );

  const handleOpenDay = useCallback(
    (day: Date) => {
      selectDay(day);
      setView('day');
    },
    [selectDay, setView],
  );

  const handleOpenOccurrence = useCallback(
    (o: Occurrence) => {
      setFocusEvent(o.event);
      openDetail(o);
    },
    [openDetail],
  );

  /* --- AI action application ------------------------------------------------ */
  const applyAction = useCallback(
    async (action: ProposedAction): Promise<string | null> => {
      try {
        if (action.kind === 'create_event') {
          if (!action.event) return null;
          if (!action.event.title || action.missing?.length) {
            // Don't guess: open the form with everything we did resolve.
            openEditor({
              event: null,
              draft: {
                title: action.event.title,
                startTime: action.event.startTime,
                endTime: action.event.endTime,
                allDay: action.event.allDay,
                location: action.event.location,
                categoryId: action.event.categoryId,
                reminders: action.event.reminders,
                recurrence: action.event.recurrence,
                description: action.event.description,
                timezone: action.event.timezone,
              },
            });
            setAiOpen(false);
            return 'I opened the event form with everything I understood — add the missing part and save.';
          }
          const created = await store.createEvent(action.event);
          jumpTo(created);
          showToast(`Added “${created.title}”`);
          return `Saved. “${created.title}” is on your calendar and syncing to your other devices.`;
        }

        if (action.kind === 'delete_event') {
          if (!action.eventId) return null;
          const target = store.events.find((e) => e.id === action.eventId);
          await store.deleteEvent(action.eventId);
          showToast(`Deleted “${target?.title ?? 'event'}”`);
          return `Deleted${target ? ` “${target.title}”` : ''}. The change is syncing to your other devices.`;
        }

        if (action.kind === 'reschedule_event' || action.kind === 'update_event') {
          if (!action.eventId) return null;

          // If the assistant offered slots rather than a decided time, open the
          // form pre-filled with the first slot and let the user choose.
          if (!action.patch && action.slots?.length) {
            const slot = action.slots[0];
            const target = store.events.find((e) => e.id === action.eventId);
            if (!target) return null;
            const durationMs = target.allDay
              ? 86_400_000
              : new Date(target.endTime).getTime() - new Date(target.startTime).getTime();
            const start = new Date(slot.startTime);
            openEditor({
              event: target,
              draft: {
                startTime: start.toISOString(),
                endTime: new Date(start.getTime() + durationMs).toISOString(),
                allDay: false,
              },
            });
            setAiOpen(false);
            return `Opening “${target.title}” at ${slotLabel(slot)} — confirm the new time to save it.`;
          }

          if (!action.patch) return null;
          const target = store.events.find((e) => e.id === action.eventId);
          if (!target) return null;
          await store.updateEvent(action.eventId, action.patch);
          const moved = { ...target, ...action.patch };
          jumpTo(moved as CalEvent);
          showToast(`Moved “${target.title}”`);
          return `Saved. “${target.title}” now starts ${describeWhen(moved as CalEvent)}.`;
        }

        return null;
      } catch (err) {
        console.error('[planify] applying AI action failed', err);
        return null;
      }
    },
    [store, openEditor, setAiOpen, showToast],
  );

  /** Bring the newly created/moved event into view. */
  const jumpTo = useCallback(
    (event: CalEvent) => {
      const start = event.allDay ? fromDayKey(event.startTime.slice(0, 10)) : new Date(event.startTime);
      if (Number.isNaN(start.getTime())) return;
      selectDay(startOfDay(start));
    },
    [selectDay],
  );

  /* --- Google Calendar ------------------------------------------------------ */
  const connectGoogleCalendar = useCallback(async () => {
    if (store.provider?.id !== 'cloud') {
      throw new Error('Google Calendar sync needs a cloud backend. See Settings → Data & sync.');
    }
    const res = await fetch('/api/gcal/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'The Google Calendar service is not configured.');
    }
    const { url } = (await res.json()) as { url: string };
    await store.setGoogleLink({
      connected: false,
      status: 'syncing',
      lastSyncAt: null,
      mode: 'two-way',
      scopesGranted: [],
      message: 'Waiting for you to approve access in the Google window…',
    });
    window.location.href = url;
  }, [store, user.id]);

  const disconnectGoogleCalendar = useCallback(async () => {
    await fetch('/api/gcal/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    }).catch(() => undefined);
    await store.setGoogleLink({
      connected: false,
      status: 'idle',
      lastSyncAt: null,
      mode: 'two-way',
      scopesGranted: [],
      message: null,
    });
    showToast('Google Calendar disconnected');
  }, [store, user.id, showToast]);

  const changeGoogleMode = useCallback(
    async (mode: 'two-way' | 'import' | 'export') => {
      await store.setGoogleLink({ ...store.googleLink, mode });
      showToast(`Google Calendar sync set to ${mode}`);
    },
    [store, showToast],
  );

  /* --- export ---------------------------------------------------------------- */
  const handleExport = useCallback(() => {
    downloadJSON(`planify-export-${dayKey(new Date())}.json`, {
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email, name: user.name },
      events: store.events.filter((e) => !e.deleted),
    });
    showToast('Export downloaded');
  }, [store.events, user, showToast]);

  /* --- mobile tab routing ------------------------------------------------------ */
  const handleTab = useCallback(
    (t: MobileTab) => {
      setTab(t);
      if (t === 'add') {
        openCreate(selectedDay, Math.max(settings.dayStartHour, new Date().getHours()));
        setTab('calendar');
      } else if (t === 'assistant') {
        setAiOpen(true);
      } else if (t === 'settings') {
        setSettingsOpen(true);
        setTab('calendar');
      } else if (t === 'agenda') {
        setView('agenda');
        setSearchOpen(false);
      } else if (t === 'calendar') {
        if (view === 'agenda') setView('month');
        setSearchOpen(false);
      }
    },
    [openCreate, selectedDay, settings.dayStartHour, setAiOpen, setSettingsOpen, setView, view, setSearchOpen],
  );

  /* --- derived labels ------------------------------------------------------------ */
  const title = useMemo(() => {
    if (view === 'month') return formatMonthTitle(anchor);
    if (view === 'week')
      return formatRangeTitle(
        range.days[0],
        range.days[Math.min(range.days.length - 1, settings.weekViewDays - 1)],
      );
    if (view === 'day')
      return selectedDay.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    return 'Agenda';
  }, [view, anchor, range.days, selectedDay, settings.weekViewDays]);

  const subtitle = useMemo(() => {
    const count = occurrences.length;
    if (totalEvents === 0) return 'No events yet';
    if (view === 'agenda') return `${count} upcoming event${count === 1 ? '' : 's'}`;
    return `${count} event${count === 1 ? '' : 's'} in view`;
  }, [occurrences.length, totalEvents, view]);

  const filtersActive = isFilterActive(filters);
  const showingNothing = filtersActive && visibleEvents.length === 0 && totalEvents > 0;

  const status: DataStatus = store.status;

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden">
      {/* Sidebar (desktop) */}
      <Sidebar
        anchor={anchor}
        selectedDay={selectedDay}
        view={view}
        events={store.events}
        settings={settings}
        theme={resolved}
        user={user}
        status={status}
        hiddenCategoryIds={hiddenCategoryIds}
        onToggleCategory={onToggleCategory}
        onSelectDay={selectDay}
        onViewChange={setView}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenAi={() => setAiOpen(true)}
        onRetrySync={() => void store.retrySync()}
        pendingCount={status.pending}
      />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={isDesktop ? '' : title}
          subtitle={isDesktop ? undefined : subtitle}
          user={user}
          status={status}
          pending={status.pending}
          onOpenProfile={() => setProfileOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAi={() => setAiOpen(true)}
          onRetrySync={() => void store.retrySync()}
          isMobile={isMobile}
          profileAnchorRef={profileRef}
        />

        {isDesktop ? (
          <Toolbar
            view={view}
            onViewChange={setView}
            title={title}
            subtitle={subtitle}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToday={goToday}
            onToggleSearch={() => setSearchOpen(!searchOpen)}
            searchActive={searchOpen}
            isMobile={false}
          />
        ) : (
          <Toolbar
            view={view}
            onViewChange={setView}
            title={title}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToday={goToday}
            onToggleSearch={() => setSearchOpen(!searchOpen)}
            searchActive={searchOpen}
            isMobile
          />
        )}

        {/* Body */}
        <main
          className={cx(
            'relative flex min-h-0 flex-1 flex-col overflow-hidden',
            'border-t border-[rgb(var(--c-line)/var(--line-alpha))]',
          )}
          aria-label="Calendar"
        >
          {store.eventsError ? (
            <div className="shrink-0 px-3 pt-3 sm:px-4">
              <ErrorState
                message={store.eventsError}
                onRetry={() => void store.retrySync()}
              />
            </div>
          ) : null}

          {searchOpen ? (
            <SearchPanel
              open={searchOpen}
              query={filters.query}
              filters={filters}
              onChange={setFilters}
              onClear={clearFilters}
              events={store.events}
              theme={resolved}
              timeFormat={settings.timeFormat}
              hiddenCategoryIds={hiddenCategoryIds}
              onToggleCategoryVisibility={onToggleCategory}
              onOpenEvent={(event) => {
                const start = event.allDay
                  ? fromDayKey(event.startTime.slice(0, 10))
                  : new Date(event.startTime);
                selectDay(startOfDay(start));
                setSearchOpen(false);
                setFocusEvent(event);
                const occ: Occurrence = {
                  id: event.id,
                  seriesId: event.id,
                  event,
                  start,
                  end: event.allDay
                    ? fromDayKey(event.endTime.slice(0, 10))
                    : new Date(event.endTime),
                  startKey: event.startTime,
                  endKey: event.endTime,
                  allDay: event.allDay,
                  index: 0,
                  isRecurring: !!event.recurrence,
                };
                openDetail(occ);
              }}
              onClose={() => setSearchOpen(false)}
            />
          ) : totalEvents === 0 ? (
            <FirstRunEmpty
              onAdd={() => openCreate(selectedDay, Math.max(settings.dayStartHour, new Date().getHours()))}
              onAskAi={() => setAiOpen(true)}
            />
          ) : showingNothing ? (
            <EmptyState
              icon="filter"
              title="Nothing matches your filters"
              body={`${totalEvents} event${totalEvents === 1 ? ' is' : 's are'} hidden by the current search or category filters.`}
              action={
                <Button variant="primary" icon="close" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : occurrences.length === 0 && view !== 'agenda' ? (
            <EmptyRange
              view={view}
              totalEvents={totalEvents}
              onToday={goToday}
              onAdd={() => openCreate(selectedDay, 9)}
            />
          ) : (
            <CalendarSurface
              view={view}
              days={range.days}
              anchor={anchor}
              rangeStart={range.start}
              occurrences={occurrences}
              settings={settings}
              theme={resolved}
              now={now}
              selectedDay={selectedDay}
              query={filters.query}
              onSelectDay={selectDay}
              onOpenDay={handleOpenDay}
              onOpen={handleOpenOccurrence}
              onCreateAt={handleCreateAt}
              onCreateOn={handleCreateOn}
              onFocusEvent={setFocusEvent}
            />
          )}
        </main>
      </div>

      {/* Floating actions */}
      {!isMobile ? (
        <>
          <Fab onClick={() => openCreate(selectedDay, Math.max(settings.dayStartHour, new Date().getHours()))} attention={totalEvents === 0} />
          <AiFab open={aiOpen} onClick={() => setAiOpen(!aiOpen)} />
        </>
      ) : null}

      {isMobile ? (
        <BottomNav
          tab={tab}
          view={view}
          onTab={handleTab}
          onViewChange={setView}
          pendingSync={status.pending}
          syncError={status.state === 'error'}
        />
      ) : null}

      {/* Sheets */}
      <EventSheet
        open={!!editor}
        onClose={closeEditor}
        event={editor?.event ?? null}
        draft={editor?.draft}
        settings={settings}
      />

      <EventDetail
        open={!!detail}
        occurrence={detail}
        theme={resolved}
        timeFormat={settings.timeFormat}
        onClose={closeDetail}
        onEdit={(event, occurrence) => openEditor({ event, occurrence })}
        onAskAi={(prompt, event) => {
          setFocusEvent(event);
          closeDetail();
          setAiOpen(true);
          // Seed the composer via a synthetic send once the panel is mounted.
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('planify:ai-prompt', { detail: prompt }));
          }, 320);
        }}
      />

      <AssistantPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        settings={settings}
        events={store.events}
        focusEvent={focusEvent}
        userId={user.id}
        onApply={applyAction}
        onOpenEditor={(seed) => {
          setAiOpen(false);
          openEditor({
            event: null,
            draft: { ...defaultDraft(selectedDay, 9, settings), ...(seed ?? {}) },
          });
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={(patch) => void store.updateSettings(patch)}
        user={user}
        providerLabel={store.provider?.label ?? 'Starting up'}
        providerDescription={store.provider?.description ?? ''}
        providerMode={store.provider?.id ?? 'device'}
        status={status}
        pending={status.pending}
        onRetrySync={() => void store.retrySync()}
        onSignOut={store.signOut}
        onDeleteAccount={store.deleteAccount}
        onExport={handleExport}
        eventCount={totalEvents}
        googleLink={store.googleLink}
        onConnectGoogleCalendar={connectGoogleCalendar}
        onDisconnectGoogleCalendar={disconnectGoogleCalendar}
        onGoogleSyncModeChange={changeGoogleMode}
        hiddenCategoryIds={hiddenCategoryIds}
        onToggleCategory={onToggleCategory}
      />

      <ProfileMenu
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        anchor={profileRef.current}
        user={user}
        providerLabel={store.provider?.label ?? 'Starting up'}
        eventCount={totalEvents}
        onOpenSettings={() => {
          setProfileOpen(false);
          setSettingsOpen(true);
        }}
        onSignOut={async () => {
          setProfileOpen(false);
          await store.signOut();
        }}
        themeMode={settings.themeMode}
        onThemeMode={(m) => void store.updateSettings({ themeMode: m })}
      />

      {/* Toast */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={cx(
            'glass glass-strong animate-pop-in pointer-events-none fixed left-1/2 z-[90] -translate-x-1/2',
            'flex max-w-[92vw] items-center gap-2 rounded-full px-4 py-2 shadow-glass-lg',
            isMobile ? 'bottom-[104px]' : 'bottom-7',
          )}
        >
          <Icon name="check" size={14} weight={2.6} className="shrink-0 text-success" />
          <span className="truncate text-[12.5px] font-medium text-ink">{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function describeWhen(event: CalEvent): string {
  const start = event.allDay ? fromDayKey(event.startTime.slice(0, 10)) : new Date(event.startTime);
  return start.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: event.allDay ? undefined : 'numeric',
    minute: event.allDay ? undefined : '2-digit',
  });
}

/**
 * The empty state for a brand-new account. Deliberately calm and specific:
 * it never shows example events, only the two ways to make a real first one.
 */
function FirstRunEmpty({ onAdd, onAskAi }: { onAdd: () => void; onAskAi: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-10">
      <div className="glass animate-pop-in flex max-w-[420px] flex-col items-center rounded-[24px] px-6 py-9 text-center">
        <span className="glass mb-4 grid h-16 w-16 place-items-center rounded-full text-ink3">
          <Icon name="calendar" size={28} weight={1.5} />
        </span>
        <h2 className="font-display text-[20px] font-bold leading-tight tracking-[-0.025em] text-ink">
          No events yet
        </h2>
        <p className="mt-2 max-w-[19rem] text-balance text-[13.5px] leading-relaxed text-ink2">
          Your calendar is empty. Add your first event and it will appear here immediately, and on
          every other device you sign in on.
        </p>

        <div className="mt-5 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="primary" size="lg" icon="plus" onClick={onAdd}>
            Add event
          </Button>
          <Button variant="glass" size="lg" icon="sparkles" onClick={onAskAi}>
            Ask the assistant
          </Button>
        </div>

        <p className="mt-5 border-t border-[rgb(var(--c-line)/var(--line-alpha))] pt-4 text-[11.5px] leading-relaxed text-ink3">
          Try typing “Add lunch with Maya next Tuesday at 1 PM for 90 minutes” — the assistant shows
          you exactly what it will create and waits for your confirmation.
        </p>
      </div>
    </div>
  );
}

/** Empty *range* — the account has events, just none in the window being viewed. */
function EmptyRange({
  view,
  totalEvents,
  onToday,
  onAdd,
}: {
  view: string;
  totalEvents: number;
  onToday: () => void;
  onAdd: () => void;
}) {
  const where =
    view === 'month' ? 'this month' : view === 'week' ? 'this week' : view === 'day' ? 'on this day' : 'in this range';
  return (
    <EmptyState
      icon="calendar"
      title={`Nothing ${where}`}
      body={`You have ${totalEvents} event${totalEvents === 1 ? '' : 's'} in total, just not here. Jump back to today or add something new.`}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="glass" icon="today" onClick={onToday}>
            Go to today
          </Button>
          <Button variant="primary" icon="plus" onClick={onAdd}>
            Add event
          </Button>
        </div>
      }
    />
  );
}
