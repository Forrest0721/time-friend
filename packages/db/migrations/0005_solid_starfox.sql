CREATE TYPE "public"."period_kind" AS ENUM('week', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."period_snapshot_status" AS ENUM('current', 'stale', 'superseded');--> statement-breakpoint
CREATE TABLE "period_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "period_snapshot_status" NOT NULL,
	"source_watermark" timestamp with time zone NOT NULL,
	"input_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"metrics_json" jsonb NOT NULL,
	"entity_index_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_snapshots_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "period_snapshots_period_version_unique" UNIQUE("period_id","version"),
	CONSTRAINT "period_snapshots_period_hash_unique" UNIQUE("period_id","input_hash"),
	CONSTRAINT "period_snapshots_version_valid" CHECK ("period_snapshots"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "period_kind" NOT NULL,
	"timezone" text NOT NULL,
	"local_start_date" date NOT NULL,
	"local_end_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "periods_identity_unique" UNIQUE("user_id","kind","starts_at","timezone"),
	CONSTRAINT "periods_bounds_valid" CHECK ("periods"."starts_at" < "periods"."ends_at" AND "periods"."local_start_date" <= "periods"."local_end_date"),
	CONSTRAINT "periods_v1_week_only" CHECK ("periods"."kind" = 'week')
);
--> statement-breakpoint
ALTER TABLE "period_snapshots" ADD CONSTRAINT "period_snapshots_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_snapshots" ADD CONSTRAINT "period_snapshots_period_fk" FOREIGN KEY ("user_id","period_id") REFERENCES "public"."periods"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "period_snapshots_one_current_per_period" ON "period_snapshots" USING btree ("period_id") WHERE "period_snapshots"."status" = 'current';--> statement-breakpoint
CREATE INDEX "period_snapshots_user_period_created_idx" ON "period_snapshots" USING btree ("user_id","period_id","created_at");--> statement-breakpoint
CREATE INDEX "periods_user_starts_idx" ON "periods" USING btree ("user_id","starts_at");