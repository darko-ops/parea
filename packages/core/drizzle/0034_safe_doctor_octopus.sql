-- Hosts of an album, and asking to be one.
--
-- `contribute_policy = 'host'` has always meant more than one person on an
-- album inside a group — the creator *and* the group's admins — while both
-- clients labelled it "Only me". This is the half of fixing that label which
-- lives in the database: a role on the participant row, so whoever made an
-- album can hand somebody the camera without handing over the album.
--
-- The request table is the other half, and it is shaped like
-- `event_access_request` for the same reasons: one row per person per album so
-- asking twice updates rather than stacks, and a declined row kept rather than
-- deleted so "no" is a decision made once. Neither table grants anything —
-- approving writes `host` into `event_participant.role`, which is the column
-- `authorize` reads.
CREATE TABLE "event_host_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
ALTER TABLE "event_participant" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_host_request" ADD CONSTRAINT "event_host_request_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_host_request" ADD CONSTRAINT "event_host_request_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_host_request" ADD CONSTRAINT "event_host_request_resolved_by_actor_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_host_request_actor_idx" ON "event_host_request" USING btree ("event_id","actor_id");--> statement-breakpoint
CREATE INDEX "event_host_request_open_idx" ON "event_host_request" USING btree ("event_id","status");
--> statement-breakpoint
-- The albums that were closed to everybody, moved to the strictest thing still
-- on offer.
--
-- "Nobody, including you" is no longer one of the answers to "who can add
-- photos": it was a way of ending an album that people reached for by accident
-- and could not find their way back out of, since the setting that would undo
-- it is the one they had just closed. `creator` is the nearest true statement
-- — the album is one person's to add to — and it is the one that leaves
-- whoever made it able to change their mind.
--
-- `authorize` still understands `nobody`, so a row that somehow keeps the
-- value behaves as it always did rather than falling through to the permissive
-- path. Nothing writes it any more.
UPDATE "event" SET "contribute_policy" = 'creator' WHERE "contribute_policy" = 'nobody';
