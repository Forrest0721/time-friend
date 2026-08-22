import type { FastifyRequest } from "fastify";

import type {
  Folder,
  AccountPrivacyService,
  Item,
  LearningPolicy,
  TaskEvent,
  ExecutionService,
  TaskGroup,
  TaskList,
  TaskPriority,
  TaskService,
  TaskStatus,
  TrajectoryFeedbackService,
  TrajectoryReviewService,
  TrajectoryService,
  UserPreferenceService,
} from "@time-friend/domain";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
  weekStartsOn: 1;
  agentEnabled: boolean;
}

export type TaskApplication = Pick<
  TaskService,
  | "getTaskData"
  | "getItem"
  | "listItems"
  | "listTaskEvents"
  | "createFolder"
  | "updateFolder"
  | "createTaskList"
  | "updateTaskList"
  | "createTaskGroup"
  | "updateTaskGroup"
  | "createItem"
  | "updateItem"
  | "transitionTask"
  | "deleteItem"
  | "reorderFolders"
  | "reorderTaskLists"
  | "reorderTaskGroups"
  | "reorderItems"
>;

export type ExecutionApplication = Pick<
  ExecutionService,
  | "getActiveFocusSession"
  | "listFocusSessions"
  | "listFocusRecords"
  | "listProgressEntries"
  | "getTaskExecutionSummary"
  | "startFocus"
  | "pauseFocus"
  | "resumeFocus"
  | "finishFocus"
  | "cancelFocus"
  | "submitFocusFeedback"
  | "adjustFocusDuration"
  | "retargetFocus"
  | "deleteFocus"
  | "createManualProgress"
  | "updateProgress"
  | "deleteProgress"
>;

export type TrajectoryApplication = Pick<
  TrajectoryService,
  | "ensureCurrentWeek"
  | "listWeeks"
  | "getWeek"
  | "generateSnapshot"
  | "markSnapshotsStale"
  | "markSnapshotsStaleForLocalDate"
  | "markSnapshotsContainingEntity"
  | "markAllSnapshotsStale"
>;
export type TrajectoryReviewApplication = Pick<
  TrajectoryReviewService,
  "requestGeneration" | "getRun" | "getReviewForPeriod" | "listReviews"
>;
export type TrajectoryFeedbackApplication = Pick<
  TrajectoryFeedbackService,
  | "decideClaim"
  | "excludeEvidence"
  | "confirmReview"
  | "listMemories"
  | "reviseMemory"
  | "deactivateMemory"
  | "deleteMemory"
  | "listDirections"
  | "updateDirection"
  | "createCommitment"
  | "confirmCommitment"
  | "updateCommitment"
  | "setCommitmentStatus"
>;
export type UserPreferenceApplication = Pick<UserPreferenceService, "setAgentEnabled">;
export type AccountPrivacyApplication = Pick<AccountPrivacyService, "exportData" | "requestDeletion">;

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
}

export interface IdempotencyExecutor {
  execute<T>(input: {
    userId: string;
    routeKey: string;
    idempotencyKey: string;
    requestBody: unknown;
    operation: () => Promise<IdempotentResult<T>>;
  }): Promise<IdempotentResult<T>>;
}

export interface ApiDependencies {
  tasks: TaskApplication;
  execution: ExecutionApplication;
  trajectory: TrajectoryApplication;
  trajectoryReviews: TrajectoryReviewApplication;
  trajectoryFeedback: TrajectoryFeedbackApplication;
  preferences: UserPreferenceApplication;
  privacy: AccountPrivacyApplication;
  resolveSession(request: FastifyRequest): Promise<AuthenticatedUser | null>;
  idempotency: IdempotencyExecutor;
  handleAuthRequest?(request: FastifyRequest): Promise<Response>;
}

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
  }
}

export type { Folder, Item, LearningPolicy, TaskEvent, TaskGroup, TaskList, TaskPriority, TaskStatus };
