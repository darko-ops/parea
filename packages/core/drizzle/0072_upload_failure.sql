CREATE TABLE "upload_failure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"event_id" uuid,
	"photo_id" uuid,
	"source" text NOT NULL,
	"stage" text NOT NULL,
	"kind" text,
	"error" text NOT NULL,
	"cause" text,
	"attempts" integer,
	"status" text,
	"client" text,
	"user_agent" text,
	"mime" text,
	"byte_size" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_failure" ADD CONSTRAINT "upload_failure_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_failure_created_idx" ON "upload_failure" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "upload_failure_actor_idx" ON "upload_failure" USING btree ("actor_id","created_at");