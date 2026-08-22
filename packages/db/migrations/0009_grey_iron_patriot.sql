CREATE TYPE "public"."account_deletion_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"subject_hash" text NOT NULL,
	"status" "account_deletion_status" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_active_user_unique" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."user_id" IS NOT NULL AND "account_deletion_requests"."status" IN ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_requested_idx" ON "account_deletion_requests" USING btree ("status","requested_at");