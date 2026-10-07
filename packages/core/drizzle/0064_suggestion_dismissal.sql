CREATE TABLE "suggestion_dismissal" (
	"actor_id" uuid NOT NULL,
	"dismissed_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_dismissal_actor_id_dismissed_actor_id_pk" PRIMARY KEY("actor_id","dismissed_actor_id")
);
--> statement-breakpoint
ALTER TABLE "suggestion_dismissal" ADD CONSTRAINT "suggestion_dismissal_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_dismissal" ADD CONSTRAINT "suggestion_dismissal_dismissed_actor_id_actor_id_fk" FOREIGN KEY ("dismissed_actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;