CREATE TABLE "confirmed_memory_evidence_dependencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"entity_type" "evidence_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_evidence_dependencies_unique" UNIQUE("memory_id","entity_type","entity_id")
);
--> statement-breakpoint
ALTER TABLE "confirmed_memories" ADD COLUMN "review_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "confirmed_memories" ADD COLUMN "review_required_reason" text;--> statement-breakpoint
ALTER TABLE "confirmed_memory_evidence_dependencies" ADD CONSTRAINT "memory_evidence_dependencies_memory_fk" FOREIGN KEY ("user_id","memory_id") REFERENCES "public"."confirmed_memories"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_evidence_dependencies_entity_idx" ON "confirmed_memory_evidence_dependencies" USING btree ("user_id","entity_type","entity_id");