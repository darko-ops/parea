CREATE TABLE "mail_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"mail_kind" text NOT NULL,
	"detail" text,
	"recipient_hash" text NOT NULL,
	"to_alert_address" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_event_created_idx" ON "mail_event" USING btree ("created_at");