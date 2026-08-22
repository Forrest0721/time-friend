ALTER TABLE "items" DROP CONSTRAINT "items_parent_task_fk";
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_task_fk" FOREIGN KEY ("user_id","list_id","parent_task_id") REFERENCES "public"."items"("user_id","list_id","id") ON DELETE restrict ON UPDATE cascade;