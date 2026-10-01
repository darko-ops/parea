CREATE TABLE "account_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_closure_closed_idx" ON "account_closure" USING btree ("closed_at");