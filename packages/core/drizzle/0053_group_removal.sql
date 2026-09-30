CREATE TABLE "group_removal" (
	"group_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"removed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_removal_group_id_actor_id_pk" PRIMARY KEY("group_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "group_removal" ADD CONSTRAINT "group_removal_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_removal" ADD CONSTRAINT "group_removal_actor_id_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_removal" ADD CONSTRAINT "group_removal_removed_by_actor_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."actor"("id") ON DELETE set null ON UPDATE no action;