CREATE TABLE "group_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"invited_by_actor_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "group_invite" ADD CONSTRAINT "group_invite_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite" ADD CONSTRAINT "group_invite_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite" ADD CONSTRAINT "group_invite_invited_by_actor_id_actor_id_fk" FOREIGN KEY ("invited_by_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_invite_pair_idx" ON "group_invite" USING btree ("group_id","actor_id");--> statement-breakpoint
CREATE INDEX "group_invite_inbox_idx" ON "group_invite" USING btree ("actor_id","status");