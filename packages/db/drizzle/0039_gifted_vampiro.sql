CREATE TABLE "admin_issue" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"network_id" integer,
	"network_name" text,
	"due_date" timestamp,
	"resolution_note" text,
	"created_by" text,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_issue_assignee" (
	"issue_id" integer NOT NULL,
	"admin_user_id" text NOT NULL,
	"assigned_by" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_issue_assignee_issue_id_admin_user_id_pk" PRIMARY KEY("issue_id","admin_user_id")
);
--> statement-breakpoint
ALTER TABLE "admin_issue" ADD CONSTRAINT "admin_issue_created_by_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_issue" ADD CONSTRAINT "admin_issue_resolved_by_admin_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_issue_assignee" ADD CONSTRAINT "admin_issue_assignee_issue_id_admin_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."admin_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_issue_assignee" ADD CONSTRAINT "admin_issue_assignee_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_issue_assignee" ADD CONSTRAINT "admin_issue_assignee_assigned_by_admin_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_issue_assignee_user_idx" ON "admin_issue_assignee" USING btree ("admin_user_id");--> statement-breakpoint
-- Seed the new elevated staff role (manages Issues + Content, not Staff). Idempotent so a
-- re-run is safe. Mirrors the inline admin_role seed in 0005_typical_medusa.sql.
INSERT INTO "admin_role" ("key", "label", "description", "assignable", "requires_approval", "sort_order") VALUES
	('system_admin', 'System Admin', 'Elevated staff: manages Issues and Content Management, but not Staff. Granted by the owner.', true, false, 2)
ON CONFLICT ("key") DO NOTHING;