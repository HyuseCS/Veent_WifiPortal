ALTER TABLE "admin_issue" ADD COLUMN "source" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_issue" ADD CONSTRAINT "admin_issue_status_ck" CHECK ("admin_issue"."status" in ('open', 'in_progress', 'resolved'));--> statement-breakpoint
ALTER TABLE "admin_issue" ADD CONSTRAINT "admin_issue_priority_ck" CHECK ("admin_issue"."priority" in ('low', 'medium', 'high'));--> statement-breakpoint
ALTER TABLE "admin_issue" ADD CONSTRAINT "admin_issue_source_ck" CHECK ("admin_issue"."source" in ('human', 'sentry'));