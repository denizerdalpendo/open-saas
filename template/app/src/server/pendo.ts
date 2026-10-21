const PENDO_TRACK_EVENT_URL = "https://data.pendo-dev.pendo-dev.com/data/track";

// Open SaaS has no account/organization concept (the client-side `pendo.identify`
// only identifies the visitor), so we use Pendo's placeholder account ID.
const PENDO_ACCOUNT_ID = "system";

// Keeps a slow Pendo response from noticeably delaying sign-ups or payment webhooks.
const PENDO_TRACK_EVENT_TIMEOUT_MS = 3000;

type PendoTrackEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Sends a Pendo Track Event from the server, for outcomes that happen outside
 * of the browser (e.g. payment webhooks and sign-ups).
 *
 * `visitorId` is the user's `id`, the same visitor ID that `pendo.identify` uses on the client.
 *
 * Does nothing if the `PENDO_TRACK_EVENT_SECRET` env var is not set.
 * Never throws: tracking failures are only logged, so they can't break the calling flow
 * (e.g. a failed payments webhook would be retried by the payment processor).
 */
export async function sendPendoTrackEvent(
  event: string,
  visitorId: string,
  properties: PendoTrackEventProperties,
): Promise<void> {
  const trackEventSecret = process.env.PENDO_TRACK_EVENT_SECRET;
  if (!trackEventSecret) {
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
        accountId: PENDO_ACCOUNT_ID,
        timestamp: Date.now(),
        properties,
      }),
      signal: AbortSignal.timeout(PENDO_TRACK_EVENT_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(
        `Failed to send Pendo Track Event "${event}": HTTP ${response.status}`,
      );
    }
  } catch (error) {
    console.error(`Failed to send Pendo Track Event "${event}":`, error);
  }
}
