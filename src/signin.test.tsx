// @vitest-environment jsdom
/**
 * Sign-in → calendar integration test.
 *
 * Reproduces the reported bug ("every time I try to log in it doesn't go to my
 * calendar") by driving the real UI against the real on-device provider. Only
 * the browser APIs jsdom lacks are stubbed, so a failure here means a user
 * genuinely cannot get past the welcome screen.
 *
 * IndexedDB persists across the tests in this file on purpose: the last one
 * resets the module graph (simulating a page reload) and asserts the session
 * survives, which is the persistence requirement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

afterEach(cleanup);

/** Import App with a fresh module graph — the equivalent of a page reload. */
async function loadApp() {
  vi.resetModules();
  const { App } = await import('./App');
  return App;
}

/** True once the calendar shell is on screen. Uses `All` because the empty state
 * and the floating action button both expose an "Add event" control. */
function onCalendar() {
  return screen.queryAllByRole('button', { name: /add event|new event/i }).length > 0;
}

function onWelcome() {
  return screen.queryAllByRole('button', { name: /continue with google/i }).length > 0;
}

function onOnboarding() {
  return !!screen.queryByText(/step \d of/i);
}

async function renderApp() {
  const App = await loadApp();
  render(<App />);
  // Boot resolves the provider asynchronously, so wait for the first screen.
  await waitFor(
    () => {
      expect(onWelcome() || onOnboarding() || onCalendar(), 'app never left the boot splash').toBe(
        true,
      );
    },
    { timeout: 8000 },
  );
}

/** Open the on-device form if it is collapsed, then submit it. */
async function signInOnDevice(name = 'Test User') {
  const toggle = screen.queryByRole('button', { name: /device account/i });
  if (toggle && !screen.queryByLabelText(/your name/i)) fireEvent.click(toggle);

  const nameInput = await screen.findByLabelText(/your name/i);
  fireEvent.change(nameInput, { target: { value: name } });

  const submit = screen.getByRole('button', { name: /start with an empty calendar/i });
  fireEvent.submit(submit.closest('form')!);
}

/** Click forward through onboarding until it dismisses. */
async function finishOnboarding() {
  for (let i = 0; i < 8; i += 1) {
    if (!screen.queryByText(/step \d of/i)) return;
    const buttons = screen
      .queryAllByRole('button')
      .filter((b) =>
        /open my calendar|finish|get started|done|continue|next/i.test(b.textContent ?? ''),
      );
    const next = buttons[buttons.length - 1];
    if (!next) return;
    fireEvent.click(next);
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe('the Google button on a device-only install', () => {
  it('does not dead-end: it explains and keeps a working path visible', async () => {
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    // No cloud backend is configured here, so OAuth cannot complete. The screen
    // must say so and leave an obvious way in.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    const deviceEntry = screen.queryByRole('button', { name: /device account/i });
    const localForm = screen.queryByLabelText(/your name/i);
    expect(deviceEntry || localForm, 'no visible way to continue after Google fails').toBeTruthy();
  });

  it('never leaves the button stuck in a loading state', async () => {
    await renderApp();
    const google = screen.getByRole('button', { name: /continue with google/i });

    fireEvent.click(google);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    await waitFor(() => expect((google as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('device sign-in reaches the calendar', () => {
  it('goes welcome → onboarding → an empty calendar', async () => {
    await renderApp();
    await signInOnDevice();

    // Onboarding is the step users mistake for being stuck.
    await waitFor(() => expect(onOnboarding()).toBe(true), { timeout: 6000 });

    await finishOnboarding();

    // This is the assertion that was failing: "Open my calendar" used to bounce
    // straight back to step 1, trapping the user in onboarding forever.
    await waitFor(() => expect(onOnboarding(), 'still on onboarding').toBe(false), {
      timeout: 8000,
    });
    await waitFor(() => expect(onCalendar(), 'calendar never rendered').toBe(true), {
      timeout: 8000,
    });
  });

  it('does not hang on the boot splash after signing in', async () => {
    // Same session as the previous test, reloaded.
    await renderApp();
    expect(onOnboarding() || onCalendar() || onWelcome(), 'stuck on the boot splash').toBe(true);
  });

  it('keeps the user signed in across a reload', async () => {
    await renderApp();
    // A persisted session must skip the welcome screen entirely, and because
    // onboarding was completed it must land directly on the calendar.
    expect(onWelcome(), 'signed out after reload').toBe(false);
    await waitFor(() => expect(onCalendar(), 'did not return to the calendar').toBe(true), {
      timeout: 8000,
    });
  });
});
