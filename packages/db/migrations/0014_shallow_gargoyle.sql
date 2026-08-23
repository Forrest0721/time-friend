ALTER TABLE "agent_runs" ADD COLUMN "tool_calls_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "estimated_cost_microusd" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_cost_valid" CHECK ("agent_runs"."estimated_cost_microusd" IS NULL OR "agent_runs"."estimated_cost_microusd" >= 0);