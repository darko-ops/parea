CREATE TABLE "event_thread_read" (
	"actor_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_thread_read_actor_id_event_id_pk" PRIMARY KEY("actor_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "group_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"author_actor_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "group_thread_read" (
	"actor_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_thread_read_actor_id_group_id_pk" PRIMARY KEY("actor_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "event_thread_read" ADD CONSTRAINT "event_thread_read_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_thread_read" ADD CONSTRAINT "event_thread_read_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_message" ADD CONSTRAINT "group_message_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_message" ADD CONSTRAINT "group_message_author_actor_id_actor_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_thread_read" ADD CONSTRAINT "group_thread_read_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_thread_read" ADD CONSTRAINT "group_thread_read_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_message_thread_idx" ON "group_message" USING btree ("group_id","created_at");--> statement-breakpoint
-- The same bound `event_message` carries, for the same reasons: the size is a
-- storage fact and belongs in the database, while "not empty" is a meaning
-- fact and stays in the route — a deleted message is legitimately empty,
-- because deletion overwrites the body rather than hiding it behind a flag.
--
-- Kept in step with `MAX_BODY`, which both thread modules import.
ALTER TABLE "group_message" ADD CONSTRAINT "group_message_body_len"
  CHECK (length("body") <= 2000);
