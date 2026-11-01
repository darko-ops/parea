CREATE TABLE "event_dismissal" (
	"actor_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_dismissal_actor_id_event_id_pk" PRIMARY KEY("actor_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "event_dismissal" ADD CONSTRAINT "event_dismissal_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_dismissal" ADD CONSTRAINT "event_dismissal_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;