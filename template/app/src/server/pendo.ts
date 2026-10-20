const PENDO_TRACK_EVENT_URL = "https://data.pendo-dev.pendo-dev.com/data/track";
const PENDO_TRACK_EVENT_TIMEOUT_MS = 5000;

// Payment processors can deliver the same webhook event more than once (e.g. on retries),
// so we remember the most recently sent dedupe keys to avoid tracking duplicate events.
const MAX_REMEMBERED_DEDUPE_KEYS = 1000;
const sentDedupeKeys = new Set<string>();

type PendoTrackEventProperties = Record<
  string,
  string | number | boolean | null
>;

interface SendPendoTrackEventArgs {
  event: string;
  /**
   * Must match the visitor ID that the client passes to `pendo.identify`, i.e. the user's ID.
   */
  visitorId: string;
  properties: PendoTrackEventProperties;
  /**
   * Unique ID of the tracked occurrence, e.g. a webhook event ID.
   * If an event with the same dedupe key was already sent by this server, it is skipped.
   */
  dedupeKey?: string;
}

/**
 * Sends a server-side Pendo Track Event, for outcomes that happen outside of the browser
 * (e.g. payment webhooks or signups), where the client-side `pendo.track()` can't be used.
 *
 * It never throws or rejects, so tracking failures can't break the calling flow,
 * and callers don't need to wait for it.
 *
 * Open SaaS doesn't have accounts (e.g. teams or organizations) and the client-side
 * `pendo.identify` call doesn't set one, so events are only associated with the visitor.
 */
export async function sendPendoTrackEvent({
  event,
  visitorId,
  properties,
  dedupeKey,
}: SendPendoTrackEventArgs): Promise<void> {
  const pendoTrackEventSecret = process.env.PENDO_TRACK_EVENT_SECRET;
  if (!pendoTrackEventSecret) {
    console.warn(
      `PENDO_TRACK_EVENT_SECRET is not set, skipping Pendo track event "${event}".`,
    );
    return;
  }

  if (dedupeKey && isDuplicate(`${event}:${dedupeKey}`)) {
    return;
  }

  try {
    const response = await fetch(PENDO_TRACK_EVENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pendo-integration-key": pendoTrackEventSecret,
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
        `Pendo track event "${event}" failed with status ${response.status}.`,
      );
    }
  } catch (error) {
    console.error(`Failed to send Pendo track event "${event}":`, error);
  }
}

/**
 * Returns `true` if the dedupe key was already seen, otherwise remembers it and returns `false`.
 */
function isDuplicate(dedupeKey: string): boolean {
  if (sentDedupeKeys.has(dedupeKey)) {
    return true;
  }

  sentDedupeKeys.add(dedupeKey);
  if (sentDedupeKeys.size > MAX_REMEMBERED_DEDUPE_KEYS) {
    // Sets iterate in insertion order, so this forgets the oldest key.
    const [oldestDedupeKey] = sentDedupeKeys;
    sentDedupeKeys.delete(oldestDedupeKey);
  }
  return false;
}
