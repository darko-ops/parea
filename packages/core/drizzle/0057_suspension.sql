CREATE TABLE "suspension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"suspended_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" text,
	"lift_note" text
);
--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suspension_active_idx" ON "suspension" USING btree ("actor_id","lifted_at");