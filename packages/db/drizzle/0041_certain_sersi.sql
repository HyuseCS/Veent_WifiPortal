CREATE TABLE "admin_issue_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_id" integer NOT NULL,
	"actor_id" text,
	"type" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_issue_event_type_ck" CHECK ("admin_issue_event"."type" in ('created', 'status_changed', 'assigned', 'unassigned', 'priority_changed', 'comment'))
);
--> statement-breakpoint
ALTER TABLE "admin_issue_event" ADD CONSTRAINT "admin_issue_event_issue_id_admin_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."admin_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_issue_event" ADD CONSTRAINT "admin_issue_event_actor_id_admin_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_issue_event_issue_idx" ON "admin_issue_event" USING btree ("issue_id","created_at");