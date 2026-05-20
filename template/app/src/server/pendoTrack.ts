const PENDO_TRACK_URL = "https://data.pendo.io/data/track";
const PENDO_INTEGRATION_KEY = "e0f214df-ae77-4b97-b526-790132c4c2d0";

interface PendoTrackEventOptions {
  event: string;
  visitorId: string;
  accountId?: string;
  properties?: Record<string, string | number | boolean>;
}

export async function pendoTrackEvent({
  event,
  visitorId,
  accountId,
  properties,
}: PendoTrackEventOptions): Promise<void> {
  try {
    await fetch(PENDO_TRACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pendo-integration-key": PENDO_INTEGRATION_KEY,
      },
      body: JSON.stringify({
        type: "track",
        event,
        visitorId,
        accountId: accountId || "system",
        timestamp: Date.now(),
        properties,
      }),
    });
  } catch (error) {
    console.error(`Pendo track event "${event}" failed:`, error);
  }
}
