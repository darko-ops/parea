CREATE TABLE "block" (
	"blocker_actor_id" uuid NOT NULL,
	"blocked_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_blocker_actor_id_blocked_actor_id_pk" PRIMARY KEY("blocker_actor_id","blocked_actor_id")
);
--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "auto_hide_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_actor_id_actor_id_fk" FOREIGN KEY ("blocker_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocked_actor_id_actor_id_fk" FOREIGN KEY ("blocked_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_actor_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_open_idx" ON "report" USING btree ("status","auto_hide_at");--> statement-breakpoint
CREATE INDEX "report_photo_idx" ON "report" USING btree ("photo_id");