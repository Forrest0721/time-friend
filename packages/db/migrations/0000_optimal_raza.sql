CREATE TYPE "public"."learning_policy" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('task', 'note');--> statement-breakpoint
CREATE TYPE "public"."task_event_actor" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"week_starts_on" smallint DEFAULT 1 NOT NULL,
	"agent_enabled" boolean DEFAULT true NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_week_starts_on_monday" CHECK ("users"."week_starts_on" = 1)
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position_key" text NOT NULL,
	"archived_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folders_user_id_id_unique" UNIQUE("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position_key" text NOT NULL,
	"archived_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "groups_user_list_id_unique" UNIQUE("user_id","list_id","id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"position_key" text NOT NULL,
	"is_inbox" boolean DEFAULT false NOT NULL,
	"learning_policy" "learning_policy" DEFAULT 'include' NOT NULL,
	"archived_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "lists_inbox_has_no_folder" CHECK (NOT ("lists"."is_inbox" AND "lists"."folder_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"group_id" uuid,
	"parent_task_id" uuid,
	"kind" "item_kind" NOT NULL,
	"title" text NOT NULL,
	"status" "task_status",
	"priority" integer,
	"planned_on" date,
	"content_doc" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"position_key" text NOT NULL,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "items_user_list_id_unique" UNIQUE("user_id","list_id","id"),
	CONSTRAINT "items_title_not_blank" CHECK (length(btrim("items"."title")) > 0),
	CONSTRAINT "items_priority_valid" CHECK ("items"."priority" IS NULL OR "items"."priority" IN (0, 1, 3, 5)),
	CONSTRAINT "items_kind_fields_valid" CHECK (("items"."kind" = 'task' AND "items"."status" IS NOT NULL) OR ("items"."kind" = 'note' AND "items"."status" IS NULL AND "items"."priority" IS NULL AND "items"."parent_task_id" IS NULL AND "items"."planned_on" IS NULL)),
	CONSTRAINT "items_status_timestamps_valid" CHECK (("items"."status" = 'completed' AND "items"."completed_at" IS NOT NULL AND "items"."abandoned_at" IS NULL)
        OR ("items"."status" = 'abandoned' AND "items"."abandoned_at" IS NOT NULL AND "items"."completed_at" IS NULL)
        OR ("items"."status" = 'pending' AND "items"."completed_at" IS NULL AND "items"."abandoned_at" IS NULL)
        OR ("items"."status" IS NULL AND "items"."completed_at" IS NULL AND "items"."abandoned_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" "task_event_actor" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"route_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_json" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_list_fk" FOREIGN KEY ("user_id","list_id") REFERENCES "public"."lists"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_folder_fk" FOREIGN KEY ("user_id","folder_id") REFERENCES "public"."folders"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_list_fk" FOREIGN KEY ("user_id","list_id") REFERENCES "public"."lists"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_group_fk" FOREIGN KEY ("user_id","list_id","group_id") REFERENCES "public"."groups"("user_id","list_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_task_fk" FOREIGN KEY ("user_id","list_id","parent_task_id") REFERENCES "public"."items"("user_id","list_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_fk" FOREIGN KEY ("user_id","task_id") REFERENCES "public"."items"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "folders_user_position_idx" ON "folders" USING btree ("user_id","position_key");--> statement-breakpoint
CREATE INDEX "groups_user_list_position_idx" ON "groups" USING btree ("user_id","list_id","position_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lists_one_active_inbox_per_user" ON "lists" USING btree ("user_id") WHERE "lists"."is_inbox" = true AND "lists"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "lists_user_folder_position_idx" ON "lists" USING btree ("user_id","folder_id","position_key");--> statement-breakpoint
CREATE INDEX "items_user_list_group_position_idx" ON "items" USING btree ("user_id","list_id","group_id","position_key");--> statement-breakpoint
CREATE INDEX "items_user_parent_position_idx" ON "items" USING btree ("user_id","parent_task_id","position_key");--> statement-breakpoint
CREATE INDEX "items_user_planned_on_idx" ON "items" USING btree ("user_id","planned_on");--> statement-breakpoint
CREATE UNIQUE INDEX "task_events_user_dedupe_unique" ON "task_events" USING btree ("user_id","dedupe_key") WHERE "task_events"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "task_events_user_task_occurred_idx" ON "task_events" USING btree ("user_id","task_id","occurred_at");--> statement-breakpoint
CREATE INDEX "task_events_user_occurred_idx" ON "task_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_user_route_key_unique" ON "idempotency_records" USING btree ("user_id","route_key","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_expires_at_idx" ON "idempotency_records" USING btree ("expires_at");