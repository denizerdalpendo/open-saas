// Pendo Agent Analytics for the AI Day Scheduler agent (see `operations.ts`).
// Events go through the Pendo snippet loaded in `main.wasp` and are skipped if
// Pendo isn't available (e.g. when it is blocked by an ad blocker).
const PENDO_AGENT_ID = "NDDT_uK2WMK4NWhTSx--oOZHJHs";

type AgentEventType = "prompt" | "agent_response" | "user_reaction";

type AgentEventMetadata = {
  conversationId: string;
  messageId: string;
  content: string;
  modelUsed?: string;
  suggestedPrompt?: boolean;
  toolsUsed?: string[];
  fileUploaded?: boolean;
};

export function trackAgentEvent(
  eventType: AgentEventType,
  metadata: AgentEventMetadata,
) {
  window.pendo?.trackAgent?.(eventType, {
    agentId: PENDO_AGENT_ID,
    ...metadata,
  });
}

// `crypto.randomUUID` is only available in secure contexts (HTTPS or localhost).
export function createTrackingId(prefix: string): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${prefix}_${Date.now()}`;
}
