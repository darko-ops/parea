-- A comment or reaction on a moment is also a message in the two people's
-- own chat, carrying which moment it answered.
ALTER TABLE "group_message" ADD COLUMN "moment_id" uuid;--> statement-breakpoint
ALTER TABLE "group_message" ADD COLUMN "moment_emoji" text;--> statement-breakpoint
ALTER TABLE "group_message" ADD CONSTRAINT "group_message_moment_id_moment_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moment"("id") ON DELETE set null ON UPDATE no action;