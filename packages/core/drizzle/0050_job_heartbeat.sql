CREATE TABLE "job_run" (
	"name" text PRIMARY KEY NOT NULL,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_error" text,
	"last_alerted_at" timestamp with time zone
);
