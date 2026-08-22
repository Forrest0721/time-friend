CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."evidence_entity_type" AS ENUM('task', 'focus_session', 'progress_entry', 'task_event', 'memory');--> statement-breakpoint
CREATE TABLE "snapshot_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"entity_type" "evidence_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"task_id" uuid,
	"list_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_evidence_snapshot_entity_unique" UNIQUE("snapshot_id","entity_type","entity_id"),
	CONSTRAINT "snapshot_evidence_no_memory" CHECK ("snapshot_evidence"."entity_type" <> 'memory')
);
--> statement-breakpoint
ALTER TABLE "snapshot_evidence" ADD CONSTRAINT "snapshot_evidence_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_evidence" ADD CONSTRAINT "snapshot_evidence_snapshot_fk" FOREIGN KEY ("user_id","snapshot_id") REFERENCES "public"."period_snapshots"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshot_evidence_user_snapshot_idx" ON "snapshot_evidence" USING btree ("user_id","snapshot_id","occurred_at");--> statement-breakpoint
CREATE INDEX "snapshot_evidence_fts_idx" ON "snapshot_evidence" USING gin (to_tsvector('simple', "title" || ' ' || coalesce("excerpt", '')));--> statement-breakpoint
CREATE INDEX "snapshot_evidence_trgm_idx" ON "snapshot_evidence" USING gin (("title" || ' ' || coalesce("excerpt", '')) gin_trgm_ops);
