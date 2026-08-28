const PENDO_TRACK_URL = "https://data.pendo-dev.pendo-dev.com/data/track";
const PENDO_INTEGRATION_KEY = "8730ae66-7fce-4058-a44c-62ee4f1f8b9a";

export async function pendoTrackEvent(
  event: string,
  visitorId: string,
  accountId: string,
  properties: Record<string, string | number | boolean> = {},
): Promise<void> {
  try {
    const response = await fetch(PENDO_TRACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pendo-integration-key": PENDO_INTEGRATION_KEY,
      },
      body: JSON.stringify({
        type: "track",
        event,
        visitorId,
        accountId,
        timestamp: Date.now(),
        properties,
      }),
    });

    if (!response.ok) {
      console.error(
        `Pendo track event "${event}" failed with status ${response.status}`,
      );
    }
  } catch (err) {
    console.error(`Pendo track event "${event}" error:`, err);
  }
}
