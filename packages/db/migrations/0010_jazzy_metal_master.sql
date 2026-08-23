ALTER TABLE "focus_adjustments" ADD COLUMN "kind" text DEFAULT 'duration' NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_adjustments" ADD COLUMN "before_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "focus_adjustments" ADD COLUMN "after_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "focus_adjustments" ADD COLUMN "before_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "focus_adjustments" ADD COLUMN "after_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "focus_adjustments" ADD CONSTRAINT "focus_adjustments_kind_valid" CHECK (("focus_adjustments"."kind" = 'duration'
          AND "focus_adjustments"."before_started_at" IS NULL AND "focus_adjustments"."after_started_at" IS NULL
          AND "focus_adjustments"."before_ended_at" IS NULL AND "focus_adjustments"."after_ended_at" IS NULL)
        OR ("focus_adjustments"."kind" = 'boundaries'
          AND "focus_adjustments"."before_started_at" IS NOT NULL AND "focus_adjustments"."after_started_at" IS NOT NULL
          AND "focus_adjustments"."before_ended_at" IS NOT NULL AND "focus_adjustments"."after_ended_at" IS NOT NULL));