const DEFAULT_PENDO_DATA_HOST = "data.pendo-dev.pendo-dev.com";
const PENDO_TRACK_REQUEST_TIMEOUT_MS = 5000;

export type PendoTrackEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

interface PendoServerTrackEvent {
  event: string;
  visitorId: string;
  accountId?: string;
  properties?: PendoTrackEventProperties;
}

/**
 * Sends a Pendo Track Event from the server via the Pendo Track Event API.
 *
 * Use this for events that happen outside of the browser (e.g. payment webhooks, auth hooks).
 * The integration key is read from the `PENDO_TRACK_EVENT_SECRET` env var, and the data host
 * can be overridden with the `PENDO_DATA_HOST` env var.
 *
 * This function never throws: tracking failures are logged so they don't break the app flow.
 */
export async function sendPendoTrackEvent({
  event,
  visitorId,
  accountId,
  properties,
}: PendoServerTrackEvent): Promise<void> {
  const integrationKey = process.env.PENDO_TRACK_EVENT_SECRET;
  if (!integrationKey) {
    console.warn(
      `Pendo track event '${event}' was not sent because PENDO_TRACK_EVENT_SECRET is not set.`,
    );
    return;
  }

  const dataHost = process.env.PENDO_DATA_HOST || DEFAULT_PENDO_DATA_HOST;

  try {
    const response = await fetch(`https://${dataHost}/data/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pendo-integration-key": integrationKey,
      },
      body: JSON.stringify({
        type: "track",
        event,
        visitorId,
        accountId,
        timestamp: Date.now(),
        properties,
      }),
      signal: AbortSignal.timeout(PENDO_TRACK_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `Pendo track event '${event}' failed with status ${response.status}.`,
      );
    }
  } catch (error) {
    console.error(`Pendo track event '${event}' failed:`, error);
  }
}
