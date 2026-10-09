ALTER TABLE "event" ADD COLUMN "handed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "handed_by_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "group_member" ADD COLUMN "added_by_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "group_member" ADD COLUMN "handed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_member" ADD COLUMN "handed_by_actor_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_handed_by_actor_id_actor_id_fk" FOREIGN KEY ("handed_by_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_added_by_actor_id_actor_id_fk" FOREIGN KEY ("added_by_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_handed_by_actor_id_actor_id_fk" FOREIGN KEY ("handed_by_actor_id") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;