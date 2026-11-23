const DEFAULT_PENDO_DATA_HOST = "data.pendo-dev.pendo-dev.com";
const PENDO_TRACK_REQUEST_TIMEOUT_MS = 5000;

type PendoTrackPropertyValue = string | number | boolean | null | string[];

interface PendoTrackEventArgs {
  event: string;
  visitorId: string;
  accountId?: string;
  properties?: Record<string, PendoTrackPropertyValue | undefined>;
}

/**
 * Sends a server-side Track Event to Pendo through the Track Event API.
 *
 * Reads the integration key from the `PENDO_TRACK_EVENT_SECRET` env var, and
 * optionally the data host from `PENDO_DATA_HOST`. When the key is not set, the
 * event is skipped. This function never throws, so tracking failures don't
 * break the calling flow.
 */
export async function trackPendoEvent({
  event,
  visitorId,
  accountId,
  properties,
}: PendoTrackEventArgs): Promise<void> {
  const integrationKey = process.env.PENDO_TRACK_EVENT_SECRET;
  if (!integrationKey) {
    console.warn(
      `Pendo track event '${event}' skipped: PENDO_TRACK_EVENT_SECRET is not set.`,
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
        ...(accountId && { accountId }),
        timestamp: Date.now(),
        properties: properties ?? {},
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
