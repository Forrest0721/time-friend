ALTER TABLE "users" DROP CONSTRAINT "users_week_starts_on_monday";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "settings_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_week_starts_on_range" CHECK ("users"."week_starts_on" BETWEEN 0 AND 6);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_settings_revision_positive" CHECK ("users"."settings_revision" > 0);