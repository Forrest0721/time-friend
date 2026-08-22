import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

import type { GeneratedReview, GenerateWeeklyReviewInput } from "@time-friend/domain";

import { weeklyReviewOutputSchema } from "./schema.js";

const entityTypeSchema = z.enum(["task", "focus_session", "progress_entry", "task_event", "memory"]);
const relationSchema = z.enum(["direct", "support", "maintenance", "exploration", "unrelated"]);

export function createTrajectoryTools(input: GenerateWeeklyReviewInput): Tool[] {
  return [
    tool({
      name: "get_period_snapshot",
      description: "读取当前冻结周快照的确定性事实。数字只能来自此工具。",
      parameters: z.strictObject({ snapshotId: z.uuid() }),
      strict: true,
      timeoutMs: 5_000,
      timeoutBehavior: "raise_exception",
      errorFunction: null,
      async execute({ snapshotId }) {
        assertCurrentSnapshot(snapshotId, input);
        return input.tools.getPeriodSnapshot();
      },
    }),
    tool({
      name: "search_evidence",
      description: "在当前快照允许的任务、进展、事件和专注中搜索证据；最多返回 30 条。",
      parameters: z.strictObject({
        query: z.string().trim().min(1).max(120),
        scope: z.array(entityTypeSchema).min(1).max(5),
        limit: z.number().int().min(1).max(30).default(20),
      }),
      strict: true,
      timeoutMs: 5_000,
      timeoutBehavior: "raise_exception",
      errorFunction: null,
      async execute(parameters) {
        return input.tools.searchEvidence(parameters);
      },
    }),
    tool({
      name: "get_confirmed_memories",
      description: "读取当前有效、由用户确认的长期记忆。候选、停用和删除记忆不会返回。",
      parameters: z.strictObject({}),
      strict: true,
      timeoutMs: 5_000,
      timeoutBehavior: "raise_exception",
      errorFunction: null,
      async execute() {
        return input.tools.getConfirmedMemories();
      },
    }),
    tool({
      name: "compare_periods",
      description: "由代码比较本周与上周的确定性指标。不要自行计算差值。",
      parameters: z.strictObject({}),
      strict: true,
      timeoutMs: 5_000,
      timeoutBehavior: "raise_exception",
      errorFunction: null,
      async execute() {
        return input.tools.comparePeriods();
      },
    }),
    tool({
      name: "propose_contribution_edges",
      description: "构造方向贡献关系候选，不会写入数据库，必须等待用户确认。",
      parameters: z.strictObject({
        evidenceIds: z.array(z.uuid()).min(1).max(12),
        direction: z.string().trim().min(1).max(80),
        relation: relationSchema,
      }),
      strict: true,
      timeoutMs: 5_000,
      timeoutBehavior: "raise_exception",
      errorFunction: null,
      async execute(parameters) {
        return input.tools.proposeContributionEdges(parameters);
      },
    }),
    tool({
      name: "validate_review_evidence",
      description: "在提交最终输出前检查证据引用。Worker 之后仍会独立复验。",
      parameters: z.strictObject({ review: weeklyReviewOutputSchema }),
      strict: true,
      timeoutMs: 5_000,
      timeoutBehavior: "raise_exception",
      errorFunction: null,
      async execute({ review }) {
        return input.tools.validateReviewEvidence(review as GeneratedReview);
      },
    }),
  ];
}

function assertCurrentSnapshot(snapshotId: string, input: GenerateWeeklyReviewInput): void {
  if (snapshotId !== input.snapshot.id) throw new Error("SNAPSHOT_OUT_OF_SCOPE");
}
