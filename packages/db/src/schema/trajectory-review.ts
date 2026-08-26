import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { AgentToolCallAudit, GeneratedReview } from "@time-friend/domain";

import { createdAtColumn, entityId, updatedAtColumn, userIdColumn } from "./common.js";
import { users } from "./identity.js";
import { evidenceEntityTypeEnum, periods, periodSnapshots } from "./trajectory.js";

export const agentRunStatusEnum = pgEnum("agent_run_status", ["waiting_for_data", "queued", "running", "validating", "succeeded", "failed"]);
export const reviewStatusEnum = pgEnum("review_status", ["pending", "partially_confirmed", "confirmed", "superseded"]);
export const reviewClaimTypeEnum = pgEnum("review_claim_type", ["direction", "progress", "deviation", "blocker", "pattern"]);
export const reviewConfidenceEnum = pgEnum("review_confidence", ["low", "medium", "high"]);
export const reviewClaimStatusEnum = pgEnum("review_claim_status", ["pending", "accepted", "edited", "rejected"]);
export const evidenceRoleEnum = pgEnum("evidence_role", ["supports", "contradicts", "context"]);
export const memoryTypeEnum = pgEnum("memory_type", ["direction", "mapping", "classification", "preference", "exclusion", "direction_state"]);
export const memoryCandidateStatusEnum = pgEnum("memory_candidate_status", ["pending", "confirmed", "rejected", "expired"]);
export const commitmentStatusEnum = pgEnum("commitment_status", ["proposed", "confirmed", "paused", "dropped", "completed"]);
export const directionStateEnum = pgEnum("direction_state", ["candidate", "active", "paused", "ended", "replaced"]);
export const confirmedMemoryStatusEnum = pgEnum("confirmed_memory_status", ["active", "superseded", "deleted"]);
export const contributionRelationEnum = pgEnum("contribution_relation", ["direct", "support", "maintenance", "exploration", "unrelated"]);
export const contributionSourceEnum = pgEnum("contribution_source", ["agent_proposal", "user_confirmed"]);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: entityId(),
    userId: userIdColumn(),
    periodSnapshotId: uuid("period_snapshot_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    workflowVersion: text("workflow_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelConfigJson: jsonb("model_config_json").$type<Record<string, unknown>>().notNull().default({}),
    modelConfigHash: text("model_config_hash").notNull().default("legacy-v1"),
    promptVersion: text("prompt_version").notNull(),
    outputSchemaVersion: text("output_schema_version").notNull(),
    inputHash: text("input_hash").notNull(),
    forceLowData: boolean("force_low_data").notNull().default(false),
    status: agentRunStatusEnum("status").notNull(),
    rawOutputJson: jsonb("raw_output_json").$type<GeneratedReview>(),
    sdkTraceId: text("sdk_trace_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    toolCallsJson: jsonb("tool_calls_json").$type<AgentToolCallAudit[]>().notNull().default([]),
    estimatedCostMicrousd: integer("estimated_cost_microusd"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorDetailRedacted: text("error_detail_redacted"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "agent_runs_user_fk" }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId, table.periodSnapshotId],
      foreignColumns: [periodSnapshots.userId, periodSnapshots.id],
      name: "agent_runs_snapshot_fk",
    }).onDelete("cascade"),
    unique("agent_runs_user_id_id_unique").on(table.userId, table.id),
    uniqueIndex("agent_runs_success_input_unique")
      .on(table.userId, table.workflowVersion, table.inputHash, table.provider, table.model, table.modelConfigHash)
      .where(sql`${table.status} = 'succeeded'`),
    uniqueIndex("agent_runs_one_active_per_snapshot")
      .on(table.periodSnapshotId, table.workflowVersion)
      .where(sql`${table.status} IN ('queued', 'running', 'validating')`),
    check("agent_runs_attempts_valid", sql`${table.attempts} >= 0`),
    check("agent_runs_tokens_valid", sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)`),
    check("agent_runs_cost_valid", sql`${table.estimatedCostMicrousd} IS NULL OR ${table.estimatedCostMicrousd} >= 0`),
    index("agent_runs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const reviewVersions = pgTable(
  "review_versions",
  {
    id: entityId(),
    userId: userIdColumn(),
    periodId: uuid("period_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    agentRunId: uuid("agent_run_id").notNull(),
    version: integer("version").notNull(),
    status: reviewStatusEnum("status").notNull(),
    limitationsJson: jsonb("limitations_json").$type<string[]>().notNull().default([]),
    createdAt: createdAtColumn(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "review_versions_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.periodId], foreignColumns: [periods.userId, periods.id], name: "review_versions_period_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.snapshotId], foreignColumns: [periodSnapshots.userId, periodSnapshots.id], name: "review_versions_snapshot_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.agentRunId], foreignColumns: [agentRuns.userId, agentRuns.id], name: "review_versions_run_fk" }).onDelete("restrict"),
    unique("review_versions_user_id_id_unique").on(table.userId, table.id),
    unique("review_versions_period_version_unique").on(table.periodId, table.version),
    unique("review_versions_agent_run_unique").on(table.agentRunId),
    uniqueIndex("review_versions_one_open_per_period").on(table.periodId).where(sql`${table.status} IN ('pending', 'partially_confirmed', 'confirmed')`),
    check("review_versions_version_valid", sql`${table.version} > 0`),
    index("review_versions_user_period_created_idx").on(table.userId, table.periodId, table.createdAt),
  ],
);

export const reviewClaims = pgTable(
  "review_claims",
  {
    id: entityId(),
    userId: userIdColumn(),
    reviewVersionId: uuid("review_version_id").notNull(),
    claimType: reviewClaimTypeEnum("claim_type").notNull(),
    statement: text("statement").notNull(),
    rationale: text("rationale").notNull(),
    confidence: reviewConfidenceEnum("confidence").notNull(),
    status: reviewClaimStatusEnum("status").notNull(),
    userRevision: text("user_revision"),
    correctionKind: text("correction_kind"),
    position: integer("position").notNull(),
    proposedDirectionJson: jsonb("proposed_direction_json").$type<{ name: string; relation: string } | null>(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "review_claims_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.reviewVersionId], foreignColumns: [reviewVersions.userId, reviewVersions.id], name: "review_claims_review_fk" }).onDelete("cascade"),
    unique("review_claims_user_id_id_unique").on(table.userId, table.id),
    unique("review_claims_review_position_unique").on(table.reviewVersionId, table.position),
    check("review_claims_text_valid", sql`length(btrim(${table.statement})) > 0 AND length(btrim(${table.rationale})) > 0`),
    check("review_claims_revision_valid", sql`(${table.status} = 'edited' AND ${table.userRevision} IS NOT NULL) OR (${table.status} <> 'edited')`),
    check("review_claims_correction_kind_valid", sql`${table.correctionKind} IS NULL OR ${table.correctionKind} IN ('accurate', 'direction_name', 'wrong_association', 'maintenance', 'exploration', 'exclude_category', 'wrong')`),
  ],
);

export const evidenceRefs = pgTable(
  "evidence_refs",
  {
    id: entityId(),
    userId: userIdColumn(),
    claimId: uuid("claim_id").notNull(),
    entityType: evidenceEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    role: evidenceRoleEnum("role").notNull(),
    excerpt: text("excerpt"),
    metricsJson: jsonb("metrics_json").$type<Record<string, unknown> | null>(),
    excludedAt: timestamp("excluded_at", { withTimezone: true, mode: "date" }),
    exclusionReason: text("exclusion_reason"),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "evidence_refs_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.claimId], foreignColumns: [reviewClaims.userId, reviewClaims.id], name: "evidence_refs_claim_fk" }).onDelete("cascade"),
    unique("evidence_refs_claim_entity_unique").on(table.claimId, table.entityType, table.entityId, table.role),
    index("evidence_refs_user_entity_idx").on(table.userId, table.entityType, table.entityId),
  ],
);

export const memoryCandidates = pgTable(
  "memory_candidates",
  {
    id: entityId(),
    userId: userIdColumn(),
    reviewClaimId: uuid("review_claim_id").notNull(),
    memoryType: memoryTypeEnum("memory_type").notNull(),
    proposedValueJson: jsonb("proposed_value_json").$type<Record<string, unknown>>().notNull(),
    status: memoryCandidateStatusEnum("status").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "memory_candidates_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.reviewClaimId], foreignColumns: [reviewClaims.userId, reviewClaims.id], name: "memory_candidates_claim_fk" }).onDelete("cascade"),
    unique("memory_candidates_user_id_id_unique").on(table.userId, table.id),
    unique("memory_candidates_claim_unique").on(table.reviewClaimId),
  ],
);

export const nextPeriodCommitments = pgTable(
  "next_period_commitments",
  {
    id: entityId(),
    userId: userIdColumn(),
    sourceReviewId: uuid("source_review_id").notNull(),
    targetPeriodId: uuid("target_period_id"),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    evidenceIdsJson: jsonb("evidence_ids_json").$type<string[]>().notNull().default([]),
    status: commitmentStatusEnum("status").notNull(),
    position: integer("position").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "commitments_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.sourceReviewId], foreignColumns: [reviewVersions.userId, reviewVersions.id], name: "commitments_review_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.targetPeriodId], foreignColumns: [periods.userId, periods.id], name: "commitments_target_period_fk" }).onDelete("restrict"),
    unique("commitments_user_id_id_unique").on(table.userId, table.id),
    unique("commitments_review_position_unique").on(table.sourceReviewId, table.position),
    check("commitments_title_valid", sql`length(btrim(${table.title})) > 0`),
  ],
);

export const directions = pgTable(
  "directions",
  {
    id: entityId(),
    userId: userIdColumn(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    state: directionStateEnum("state").notNull(),
    createdFromReviewId: uuid("created_from_review_id").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "directions_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.createdFromReviewId], foreignColumns: [reviewVersions.userId, reviewVersions.id], name: "directions_review_fk" }).onDelete("restrict"),
    unique("directions_user_id_id_unique").on(table.userId, table.id),
    check("directions_name_valid", sql`length(btrim(${table.name})) > 0`),
    index("directions_user_state_idx").on(table.userId, table.state),
  ],
);

export const confirmedMemories = pgTable(
  "confirmed_memories",
  {
    id: entityId(),
    userId: userIdColumn(),
    memoryType: memoryTypeEnum("memory_type").notNull(),
    valueJson: jsonb("value_json").$type<Record<string, unknown>>().notNull(),
    sourceCandidateId: uuid("source_candidate_id"),
    sourceReviewId: uuid("source_review_id").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true, mode: "date" }),
    status: confirmedMemoryStatusEnum("status").notNull(),
    revision: integer("revision").notNull().default(1),
    supersedesId: uuid("supersedes_id"),
    reviewRequiredAt: timestamp("review_required_at", { withTimezone: true, mode: "date" }),
    reviewRequiredReason: text("review_required_reason"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "confirmed_memories_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.sourceCandidateId], foreignColumns: [memoryCandidates.userId, memoryCandidates.id], name: "confirmed_memories_candidate_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.userId, table.sourceReviewId], foreignColumns: [reviewVersions.userId, reviewVersions.id], name: "confirmed_memories_review_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.userId, table.supersedesId], foreignColumns: [table.userId, table.id], name: "confirmed_memories_supersedes_fk" }).onDelete("restrict"),
    unique("confirmed_memories_user_id_id_unique").on(table.userId, table.id),
    check("confirmed_memories_effective_valid", sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
    index("confirmed_memories_user_status_effective_idx").on(table.userId, table.status, table.effectiveFrom),
  ],
);

export const confirmedMemoryEvidenceDependencies = pgTable(
  "confirmed_memory_evidence_dependencies",
  {
    id: entityId(),
    userId: userIdColumn(),
    memoryId: uuid("memory_id").notNull(),
    entityType: evidenceEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId, table.memoryId], foreignColumns: [confirmedMemories.userId, confirmedMemories.id], name: "memory_evidence_dependencies_memory_fk" }).onDelete("cascade"),
    unique("memory_evidence_dependencies_unique").on(table.memoryId, table.entityType, table.entityId),
    index("memory_evidence_dependencies_entity_idx").on(table.userId, table.entityType, table.entityId),
  ],
);

export const contributionEdges = pgTable(
  "contribution_edges",
  {
    id: entityId(),
    userId: userIdColumn(),
    sourceType: evidenceEntityTypeEnum("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    directionId: uuid("direction_id").notNull(),
    relation: contributionRelationEnum("relation").notNull(),
    confidence: reviewConfidenceEnum("confidence").notNull(),
    source: contributionSourceEnum("source").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
    supersedesId: uuid("supersedes_id"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: "contribution_edges_user_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.directionId], foreignColumns: [directions.userId, directions.id], name: "contribution_edges_direction_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.userId, table.supersedesId], foreignColumns: [table.userId, table.id], name: "contribution_edges_supersedes_fk" }).onDelete("restrict"),
    unique("contribution_edges_user_id_id_unique").on(table.userId, table.id),
    check("contribution_edges_validity_valid", sql`${table.validTo} IS NULL OR ${table.validTo} >= ${table.validFrom}`),
    index("contribution_edges_user_source_idx").on(table.userId, table.sourceType, table.sourceId),
  ],
);
