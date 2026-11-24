export type PendoTrackEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Sends a Pendo Track Event from the browser.
 *
 * The Pendo agent automatically attaches the current visitor, so don't pass visitor ids here.
 * Tracking failures are logged and never break the app flow.
 */
export function trackPendoEvent(
  event: string,
  properties?: PendoTrackEventProperties,
): void {
  try {
    window.pendo?.track(event, properties);
  } catch (error) {
    console.error(`Pendo track event '${event}' failed:`, error);
  }
}
