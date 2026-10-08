const PENDO_TRACK_EVENT_URL = "https://data.pendo-dev.pendo-dev.com/data/track";
const PENDO_TRACK_EVENT_TIMEOUT_MS = 5000;

type PendoTrackEventProperties = Record<
  string,
  string | number | boolean | string[] | null | undefined
>;

interface PendoServerTrackEvent {
  /** Must match the event name registered in Pendo exactly. */
  event: string;
  /** The user's ID, the same visitor ID that `src/client/App.tsx` identifies with. */
  visitorId: string;
  properties: PendoTrackEventProperties;
}

let hasWarnedAboutMissingTrackEventSecret = false;

/**
 * Sends a Pendo Track Event from the server, for actions the browser can't
 * observe (e.g. payment webhooks and auth hooks).
 *
 * No account ID is sent because the app identifies Pendo visitors without
 * accounts (see `src/client/App.tsx`).
 *
 * Tracking must never break the calling flow, so this never rejects: failures
 * are only logged. It can be awaited, or fired and forgotten.
 */
export async function trackPendoServerEvent({
  event,
  visitorId,
  properties,
}: PendoServerTrackEvent): Promise<void> {
  const trackEventSecret = process.env.PENDO_TRACK_EVENT_SECRET;
  if (!trackEventSecret) {
    if (!hasWarnedAboutMissingTrackEventSecret) {
      console.warn(
        "PENDO_TRACK_EVENT_SECRET is not set, skipping server-side Pendo track events.",
      );
      hasWarnedAboutMissingTrackEventSecret = true;
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
        visitorId,
        timestamp: Date.now(),
        properties,
      }),
      signal: AbortSignal.timeout(PENDO_TRACK_EVENT_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(
        `Pendo track event "${event}" was rejected with status ${response.status}: ${await response.text()}`,
      );
    }
  } catch (error) {
    console.error(`Failed to send Pendo track event "${event}":`, error);
  }
}
