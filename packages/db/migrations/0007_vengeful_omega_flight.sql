CREATE TYPE "public"."agent_run_status" AS ENUM('waiting_for_data', 'queued', 'running', 'validating', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('proposed', 'confirmed', 'paused', 'dropped', 'completed');--> statement-breakpoint
CREATE TYPE "public"."confirmed_memory_status" AS ENUM('active', 'superseded', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."contribution_relation" AS ENUM('direct', 'support', 'maintenance', 'exploration', 'unrelated');--> statement-breakpoint
CREATE TYPE "public"."contribution_source" AS ENUM('agent_proposal', 'user_confirmed');--> statement-breakpoint
CREATE TYPE "public"."direction_state" AS ENUM('candidate', 'active', 'paused', 'ended', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."evidence_role" AS ENUM('supports', 'contradicts', 'context');--> statement-breakpoint
CREATE TYPE "public"."memory_candidate_status" AS ENUM('pending', 'confirmed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('direction', 'mapping', 'classification', 'preference', 'exclusion', 'direction_state');--> statement-breakpoint
CREATE TYPE "public"."review_claim_status" AS ENUM('pending', 'accepted', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_claim_type" AS ENUM('direction', 'progress', 'deviation', 'blocker', 'pattern');--> statement-breakpoint
CREATE TYPE "public"."review_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'partially_confirmed', 'confirmed', 'superseded');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"period_snapshot_id" uuid NOT NULL,
	"workflow_name" text NOT NULL,
	"workflow_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"output_schema_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"force_low_data" boolean DEFAULT false NOT NULL,
	"status" "agent_run_status" NOT NULL,
	"raw_output_json" jsonb,
	"sdk_trace_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_detail_redacted" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "agent_runs_attempts_valid" CHECK ("agent_runs"."attempts" >= 0),
	CONSTRAINT "agent_runs_tokens_valid" CHECK (("agent_runs"."input_tokens" IS NULL OR "agent_runs"."input_tokens" >= 0) AND ("agent_runs"."output_tokens" IS NULL OR "agent_runs"."output_tokens" >= 0))
);
--> statement-breakpoint
CREATE TABLE "confirmed_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_type" "memory_type" NOT NULL,
	"value_json" jsonb NOT NULL,
	"source_candidate_id" uuid,
	"source_review_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"status" "confirmed_memory_status" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confirmed_memories_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "confirmed_memories_effective_valid" CHECK ("confirmed_memories"."effective_to" IS NULL OR "confirmed_memories"."effective_to" >= "confirmed_memories"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "contribution_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" "evidence_entity_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"direction_id" uuid NOT NULL,
	"relation" "contribution_relation" NOT NULL,
	"confidence" "review_confidence" NOT NULL,
	"source" "contribution_source" NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_edges_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "contribution_edges_validity_valid" CHECK ("contribution_edges"."valid_to" IS NULL OR "contribution_edges"."valid_to" >= "contribution_edges"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "directions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"state" "direction_state" NOT NULL,
	"created_from_review_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "directions_name_valid" CHECK (length(btrim("directions"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evidence_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"entity_type" "evidence_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" "evidence_role" NOT NULL,
	"excerpt" text,
	"metrics_json" jsonb,
	CONSTRAINT "evidence_refs_claim_entity_unique" UNIQUE("claim_id","entity_type","entity_id","role")
);
--> statement-breakpoint
CREATE TABLE "memory_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"review_claim_id" uuid NOT NULL,
	"memory_type" "memory_type" NOT NULL,
	"proposed_value_json" jsonb NOT NULL,
	"status" "memory_candidate_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_candidates_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "memory_candidates_claim_unique" UNIQUE("review_claim_id")
);
--> statement-breakpoint
CREATE TABLE "next_period_commitments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source_review_id" uuid NOT NULL,
	"target_period_id" uuid,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "commitment_status" NOT NULL,
	"position" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commitments_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "commitments_review_position_unique" UNIQUE("source_review_id","position"),
	CONSTRAINT "commitments_title_valid" CHECK (length(btrim("next_period_commitments"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "review_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"review_version_id" uuid NOT NULL,
	"claim_type" "review_claim_type" NOT NULL,
	"statement" text NOT NULL,
	"rationale" text NOT NULL,
	"confidence" "review_confidence" NOT NULL,
	"status" "review_claim_status" NOT NULL,
	"user_revision" text,
	"position" integer NOT NULL,
	"proposed_direction_json" jsonb,
	CONSTRAINT "review_claims_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "review_claims_review_position_unique" UNIQUE("review_version_id","position"),
	CONSTRAINT "review_claims_text_valid" CHECK (length(btrim("review_claims"."statement")) > 0 AND length(btrim("review_claims"."rationale")) > 0),
	CONSTRAINT "review_claims_revision_valid" CHECK (("review_claims"."status" = 'edited' AND "review_claims"."user_revision" IS NOT NULL) OR ("review_claims"."status" <> 'edited'))
);
--> statement-breakpoint
CREATE TABLE "review_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "review_status" NOT NULL,
	"limitations_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "review_versions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "review_versions_period_version_unique" UNIQUE("period_id","version"),
	CONSTRAINT "review_versions_agent_run_unique" UNIQUE("agent_run_id"),
	CONSTRAINT "review_versions_version_valid" CHECK ("review_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_snapshot_fk" FOREIGN KEY ("user_id","period_snapshot_id") REFERENCES "public"."period_snapshots"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_memories" ADD CONSTRAINT "confirmed_memories_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_memories" ADD CONSTRAINT "confirmed_memories_candidate_fk" FOREIGN KEY ("user_id","source_candidate_id") REFERENCES "public"."memory_candidates"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_memories" ADD CONSTRAINT "confirmed_memories_review_fk" FOREIGN KEY ("user_id","source_review_id") REFERENCES "public"."review_versions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_memories" ADD CONSTRAINT "confirmed_memories_supersedes_fk" FOREIGN KEY ("user_id","supersedes_id") REFERENCES "public"."confirmed_memories"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_edges" ADD CONSTRAINT "contribution_edges_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_edges" ADD CONSTRAINT "contribution_edges_direction_fk" FOREIGN KEY ("user_id","direction_id") REFERENCES "public"."directions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_edges" ADD CONSTRAINT "contribution_edges_supersedes_fk" FOREIGN KEY ("user_id","supersedes_id") REFERENCES "public"."contribution_edges"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directions" ADD CONSTRAINT "directions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directions" ADD CONSTRAINT "directions_review_fk" FOREIGN KEY ("user_id","created_from_review_id") REFERENCES "public"."review_versions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_refs" ADD CONSTRAINT "evidence_refs_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_refs" ADD CONSTRAINT "evidence_refs_claim_fk" FOREIGN KEY ("user_id","claim_id") REFERENCES "public"."review_claims"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD CONSTRAINT "memory_candidates_claim_fk" FOREIGN KEY ("user_id","review_claim_id") REFERENCES "public"."review_claims"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_period_commitments" ADD CONSTRAINT "commitments_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_period_commitments" ADD CONSTRAINT "commitments_review_fk" FOREIGN KEY ("user_id","source_review_id") REFERENCES "public"."review_versions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_period_commitments" ADD CONSTRAINT "commitments_target_period_fk" FOREIGN KEY ("user_id","target_period_id") REFERENCES "public"."periods"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_claims" ADD CONSTRAINT "review_claims_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_claims" ADD CONSTRAINT "review_claims_review_fk" FOREIGN KEY ("user_id","review_version_id") REFERENCES "public"."review_versions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_versions" ADD CONSTRAINT "review_versions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_versions" ADD CONSTRAINT "review_versions_period_fk" FOREIGN KEY ("user_id","period_id") REFERENCES "public"."periods"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_versions" ADD CONSTRAINT "review_versions_snapshot_fk" FOREIGN KEY ("user_id","snapshot_id") REFERENCES "public"."period_snapshots"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_versions" ADD CONSTRAINT "review_versions_run_fk" FOREIGN KEY ("user_id","agent_run_id") REFERENCES "public"."agent_runs"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_success_input_unique" ON "agent_runs" USING btree ("user_id","workflow_version","input_hash") WHERE "agent_runs"."status" = 'succeeded';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_per_snapshot" ON "agent_runs" USING btree ("period_snapshot_id","workflow_version") WHERE "agent_runs"."status" IN ('queued', 'running', 'validating');--> statement-breakpoint
CREATE INDEX "agent_runs_user_created_idx" ON "agent_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "confirmed_memories_user_status_effective_idx" ON "confirmed_memories" USING btree ("user_id","status","effective_from");--> statement-breakpoint
CREATE INDEX "contribution_edges_user_source_idx" ON "contribution_edges" USING btree ("user_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "directions_user_state_idx" ON "directions" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "evidence_refs_user_entity_idx" ON "evidence_refs" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_versions_one_open_per_period" ON "review_versions" USING btree ("period_id") WHERE "review_versions"."status" IN ('pending', 'partially_confirmed', 'confirmed');--> statement-breakpoint
CREATE INDEX "review_versions_user_period_created_idx" ON "review_versions" USING btree ("user_id","period_id","created_at");