// Shared with the client so it can report the model and tool used to Pendo.
// You can use any model here, e.g. 'gpt-3.5-turbo', 'gpt-4', etc.
export const SCHEDULE_GENERATION_MODEL = "gpt-3.5-turbo";
export const PARSE_TODAYS_SCHEDULE_TOOL_NAME = "parseTodaysSchedule";

export type TaskPriority = "low" | "medium" | "high";

export type GeneratedSchedule = {
  tasks: Task[]; // Main tasks provided by user, ordered by priority
  taskItems: TaskItem[];
};

export type Task = {
  name: string;
  priority: TaskPriority;
};

export type TaskItem = {
  description: string;
  time: number; // total time it takes to complete given main task in hours, e.g. 2.75
  taskName: string; // name of main task related to subtask
};
