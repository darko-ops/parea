CREATE TABLE "friend_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_actor_id" uuid NOT NULL,
	"to_actor_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "friendship" (
	"actor_id" uuid NOT NULL,
	"friend_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_actor_id_friend_actor_id_pk" PRIMARY KEY("actor_id","friend_actor_id")
);
--> statement-breakpoint
ALTER TABLE "friend_request" ADD CONSTRAINT "friend_request_from_actor_id_actor_id_fk" FOREIGN KEY ("from_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_request" ADD CONSTRAINT "friend_request_to_actor_id_actor_id_fk" FOREIGN KEY ("to_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_friend_actor_id_actor_id_fk" FOREIGN KEY ("friend_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_request_pair_idx" ON "friend_request" USING btree ("from_actor_id","to_actor_id");--> statement-breakpoint
CREATE INDEX "friend_request_inbox_idx" ON "friend_request" USING btree ("to_actor_id","status");