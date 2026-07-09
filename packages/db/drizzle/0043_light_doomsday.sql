CREATE TABLE "admin_notification_read" (
	"user_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_notification_read_user_id_event_id_pk" PRIMARY KEY("user_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "admin_notification_read" ADD CONSTRAINT "admin_notification_read_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notification_read" ADD CONSTRAINT "admin_notification_read_event_id_admin_issue_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."admin_issue_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_profile" DROP COLUMN "notifications_seen_at";