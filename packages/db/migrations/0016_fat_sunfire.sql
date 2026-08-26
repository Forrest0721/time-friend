DROP INDEX "agent_runs_success_input_unique";--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "model_config_hash" text DEFAULT 'legacy-v1' NOT NULL;--> statement-breakpoint
UPDATE "agent_runs"
SET "model_config_json" = '{"transport":"responses","configVersion":1}'::jsonb
WHERE "model_config_json" = '{}'::jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_success_input_unique" ON "agent_runs" USING btree ("user_id","workflow_version","input_hash","provider","model","model_config_hash") WHERE "agent_runs"."status" = 'succeeded';
