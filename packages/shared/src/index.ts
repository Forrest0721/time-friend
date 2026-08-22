export type DirectionTag = "focus" | "plan" | "execution" | "review";

export interface TaskItemBase {
  id: string;
  title: string;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FocusSession {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt?: string | null;
  mode: "pomodoro" | "countup" | "manual";
}

