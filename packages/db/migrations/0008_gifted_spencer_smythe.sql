ALTER TABLE "evidence_refs" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_refs" ADD COLUMN "exclusion_reason" text;