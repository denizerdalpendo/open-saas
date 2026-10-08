type PendoTrackEventProperties = Record<
  string,
  string | number | boolean | string[] | null | undefined
>;

/**
 * Sends a Pendo Track Event from the browser.
 *
 * The Pendo agent (loaded via `app.head` in `main.wasp`) attaches the current
 * visitor to every event, so don't pass visitor or account IDs as properties.
 * Tracking must never break the app, so failures are only logged.
 */
export function trackPendoEvent(
  eventName: string,
  properties: PendoTrackEventProperties = {},
): void {
  try {
    window.pendo?.track(eventName, properties);
  } catch (error) {
    console.error(`Failed to send Pendo track event "${eventName}":`, error);
  }
}
