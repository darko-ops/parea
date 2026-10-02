CREATE TABLE "activity_day" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_day_day_kind_pk" PRIMARY KEY("day","kind")
);
--> statement-breakpoint
CREATE TABLE "activity_week" (
	"week" date NOT NULL,
	"cohort" date NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_week_week_cohort_pk" PRIMARY KEY("week","cohort")
);
--> statement-breakpoint
ALTER TABLE "actor" ADD COLUMN "counted_on" date;--> statement-breakpoint
ALTER TABLE "observation" ADD COLUMN "reason" text;