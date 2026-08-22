CREATE TYPE "public"."focus_mode" AS ENUM('pomodoro', 'stopwatch');--> statement-breakpoint
CREATE TYPE "public"."focus_segment_close_reason" AS ENUM('pause', 'finish', 'pomodoro_elapsed', 'limit', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."focus_state" AS ENUM('running', 'paused', 'awaiting_feedback', 'completed', 'canceled', 'needs_attention');--> statement-breakpoint
CREATE TYPE "public"."progress_outcome" AS ENUM('completed', 'progressed', 'blocked', 'maintenance', 'note');--> statement-breakpoint
CREATE TYPE "public"."progress_source" AS ENUM('focus_end', 'manual');--> statement-breakpoint
CREATE TABLE "focus_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"before_seconds" integer NOT NULL,
	"after_seconds" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_adjustments_seconds_valid" CHECK ("focus_adjustments"."before_seconds" BETWEEN 0 AND 86400 AND "focus_adjustments"."after_seconds" BETWEEN 0 AND 86400),
	CONSTRAINT "focus_adjustments_reason_not_blank" CHECK (length(btrim("focus_adjustments"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "focus_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"close_reason" "focus_segment_close_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_segments_close_fields_valid" CHECK (("focus_segments"."ended_at" IS NULL AND "focus_segments"."close_reason" IS NULL)
        OR ("focus_segments"."ended_at" IS NOT NULL AND "focus_segments"."close_reason" IS NOT NULL AND "focus_segments"."ended_at" >= "focus_segments"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"mode" "focus_mode" NOT NULL,
	"state" "focus_state" NOT NULL,
	"planned_seconds" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"expected_end_at" timestamp with time zone,
	"base_active_seconds" integer DEFAULT 0 NOT NULL,
	"effective_seconds" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_sessions_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "focus_sessions_mode_plan_valid" CHECK (("focus_sessions"."mode" = 'pomodoro' AND "focus_sessions"."planned_seconds" BETWEEN 60 AND 43200)
        OR ("focus_sessions"."mode" = 'stopwatch' AND "focus_sessions"."planned_seconds" IS NULL)),
	CONSTRAINT "focus_sessions_base_seconds_valid" CHECK ("focus_sessions"."base_active_seconds" >= 0),
	CONSTRAINT "focus_sessions_effective_seconds_valid" CHECK ("focus_sessions"."effective_seconds" IS NULL OR "focus_sessions"."effective_seconds" BETWEEN 0 AND 86400),
	CONSTRAINT "focus_sessions_terminal_fields_valid" CHECK (("focus_sessions"."state" IN ('running', 'paused', 'needs_attention') AND "focus_sessions"."ended_at" IS NULL AND "focus_sessions"."effective_seconds" IS NULL)
        OR ("focus_sessions"."state" IN ('awaiting_feedback', 'completed') AND "focus_sessions"."ended_at" IS NOT NULL AND "focus_sessions"."effective_seconds" IS NOT NULL)
        OR ("focus_sessions"."state" = 'canceled' AND "focus_sessions"."ended_at" IS NOT NULL AND "focus_sessions"."effective_seconds" IS NULL)),
	CONSTRAINT "focus_sessions_expected_end_valid" CHECK ("focus_sessions"."expected_end_at" IS NULL OR ("focus_sessions"."state" = 'running' AND "focus_sessions"."expected_end_at" > "focus_sessions"."started_at")),
	CONSTRAINT "focus_sessions_deleted_terminal_only" CHECK ("focus_sessions"."deleted_at" IS NULL OR "focus_sessions"."state" IN ('completed', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "progress_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"focus_session_id" uuid,
	"source" "progress_source" NOT NULL,
	"outcome" "progress_outcome" NOT NULL,
	"note" text,
	"next_step" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "progress_entries_source_valid" CHECK (("progress_entries"."source" = 'manual' AND "progress_entries"."task_id" IS NOT NULL AND "progress_entries"."focus_session_id" IS NULL AND "progress_entries"."outcome" <> 'completed')
        OR ("progress_entries"."source" = 'focus_end' AND "progress_entries"."focus_session_id" IS NOT NULL AND "progress_entries"."outcome" <> 'note')),
	CONSTRAINT "progress_entries_note_valid" CHECK ("progress_entries"."outcome" <> 'note' OR ("progress_entries"."note" IS NOT NULL AND length(btrim("progress_entries"."note")) > 0))
);
--> statement-breakpoint
ALTER TABLE "focus_adjustments" ADD CONSTRAINT "focus_adjustments_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_adjustments" ADD CONSTRAINT "focus_adjustments_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."focus_sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_segments" ADD CONSTRAINT "focus_segments_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_segments" ADD CONSTRAINT "focus_segments_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."focus_sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_fk" FOREIGN KEY ("user_id","task_id") REFERENCES "public"."items"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_task_fk" FOREIGN KEY ("user_id","task_id") REFERENCES "public"."items"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entries" ADD CONSTRAINT "progress_entries_focus_session_fk" FOREIGN KEY ("user_id","focus_session_id") REFERENCES "public"."focus_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "focus_adjustments_user_session_created_idx" ON "focus_adjustments" USING btree ("user_id","session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "focus_segments_one_open_per_session" ON "focus_segments" USING btree ("session_id") WHERE "focus_segments"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "focus_segments_user_session_started_idx" ON "focus_segments" USING btree ("user_id","session_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "focus_sessions_one_active_per_user" ON "focus_sessions" USING btree ("user_id") WHERE "focus_sessions"."state" IN ('running', 'paused', 'needs_attention') AND "focus_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "focus_sessions_user_started_idx" ON "focus_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "focus_sessions_user_task_started_idx" ON "focus_sessions" USING btree ("user_id","task_id","started_at");--> statement-breakpoint
CREATE INDEX "progress_entries_user_task_occurred_idx" ON "progress_entries" USING btree ("user_id","task_id","occurred_at");--> statement-breakpoint
CREATE INDEX "progress_entries_user_occurred_idx" ON "progress_entries" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "progress_entries_user_session_idx" ON "progress_entries" USING btree ("user_id","focus_session_id");