CREATE TABLE "admin_bypass_device" (
	"session_token" text PRIMARY KEY NOT NULL,
	"mac" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_bypass_device" ADD CONSTRAINT "admin_bypass_device_session_token_admin_session_token_fk" FOREIGN KEY ("session_token") REFERENCES "public"."admin_session"("token") ON DELETE cascade ON UPDATE no action;