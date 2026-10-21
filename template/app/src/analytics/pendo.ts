const PENDO_TRACK_EVENT_URL = "https://data.pendo-dev.pendo-dev.com/data/track";
// Callers (auth hooks, payment webhooks) await tracking, so it must not hang.
const PENDO_TRACK_EVENT_TIMEOUT_MS = 5000;

type PendoTrackEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

let hasWarnedAboutMissingSecret = false;

/**
 * Sends a server-side Pendo Track Event, for outcomes that only the server can
 * see (e.g. auth hooks and payment webhooks). In the browser, use
 * `window.pendo.track()` instead.
 *
 * Requires the `PENDO_TRACK_EVENT_SECRET` env var. If it isn't set, no events
 * are sent.
 *
 * Never throws: failures are only logged, so tracking can't break the flow
 * that is being tracked.
 */
export async function trackPendoServerEvent(
  event: string,
  visitorId: string,
  properties: PendoTrackEventProperties = {},
): Promise<void> {
  const trackEventSecret = process.env.PENDO_TRACK_EVENT_SECRET;
  if (!trackEventSecret) {
    if (!hasWarnedAboutMissingSecret) {
      hasWarnedAboutMissingSecret = true;
      console.warn(
        "PENDO_TRACK_EVENT_SECRET is not set, server-side Pendo Track Events will not be sent.",
      );
    }
    return;
  }

  try {
    const response = await fetch(PENDO_TRACK_EVENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pendo-integration-key": trackEventSecret,
      },
      body: JSON.stringify({
        type: "track",
        event,
        // Same id that `pendo.identify()` uses in `src/client/App.tsx`.
        // There is no `accountId`, because the app has no accounts and the
        // Pendo agent identifies visitors without one.
        visitorId,
        timestamp: Date.now(),
        properties,
      }),
      signal: AbortSignal.timeout(PENDO_TRACK_EVENT_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `Pendo Track Event "${event}" failed with status ${response.status}.`,
      );
    }
  } catch (error) {
    console.error(`Pendo Track Event "${event}" failed:`, error);
  }
}
