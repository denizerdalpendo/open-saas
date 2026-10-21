import type { Task } from "wasp/entities";
import type { GeneratedSchedule } from "./schedule";

// Pendo Agent Analytics for the AI Day Scheduler (the `generateGptResponse`
// action in `./operations.ts`). `window.pendo` is set up by the Pendo snippet
// in `main.wasp`.
const AGENT_ID = "wXSRM7nILCMVWHKb4WDOc6JEsYw";
// Keep in sync with the OpenAI request in `generateScheduleWithGpt`.
const MODEL_USED = "gpt-3.5-turbo";
const TOOL_USED = "parseTodaysSchedule";

type AgentEventType = "prompt" | "agent_response" | "user_reaction";

type AgentEventMetadata = {
  agentId: string;
  conversationId: string;
  messageId: string;
  content: string;
  modelUsed?: string;
  suggestedPrompt?: boolean;
  toolsUsed?: string[];
  fileUploaded?: boolean;
};

export function createAgentConversationId() {
  return generateId("conversation");
}

export function trackSchedulePrompt({
  conversationId,
  hours,
  tasks,
}: {
  conversationId: string;
  hours: number;
  tasks: Pick<Task, "description" | "time">[];
}) {
  const taskList = tasks
    .map(({ description, time }) => `${description} (${time} hrs)`)
    .join(", ");

  trackAgent("prompt", {
    agentId: AGENT_ID,
    conversationId,
    messageId: generateId("prompt"),
    content: `I will work ${hours} hours today. Tasks: ${taskList}`,
    suggestedPrompt: false,
    fileUploaded: false,
  });
}

export function trackScheduleResponse({
  conversationId,
  schedule,
}: {
  conversationId: string;
  schedule: GeneratedSchedule;
}) {
  trackAgent("agent_response", {
    agentId: AGENT_ID,
    conversationId,
    messageId: generateId("agent_response"),
    // Same JSON that `generateGptResponse` saves as the `GptResponse` content.
    content: JSON.stringify(schedule),
    modelUsed: MODEL_USED,
    toolsUsed: [TOOL_USED],
  });
}

function trackAgent(eventType: AgentEventType, metadata: AgentEventMetadata) {
  // Optional chaining keeps the app working if the Pendo snippet is removed.
  window.pendo?.trackAgent?.(eventType, metadata);
}

function generateId(prefix: string) {
  // `crypto.randomUUID` only exists in secure contexts (HTTPS or localhost).
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${prefix}_${Date.now()}`;
}
