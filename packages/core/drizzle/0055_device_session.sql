-- Which sign-in registered each push token, so ending that sign-in from the
-- Devices screen stops its notifications. Existing rows stay null until the
-- app registers again, which it does whenever it confirms who it is.
ALTER TABLE "device" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;