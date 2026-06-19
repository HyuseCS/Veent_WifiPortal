CREATE TABLE "admin_role" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"assignable" boolean DEFAULT true NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Seed the base roles BEFORE adding the FK so existing admin_profile rows
-- ('owner'/'admin') reference valid keys. `owner` is non-assignable (reached by
-- promotion, not invite) and flags requires_approval for the future approval flow.
INSERT INTO "admin_role" ("key", "label", "description", "assignable", "requires_approval", "sort_order") VALUES
	('owner', 'Owner', 'Full control. Granted by promoting an existing admin.', false, true, 0),
	('admin', 'Admin', 'Standard staff member. Created via invitation.', true, false, 1)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "admin_profile" ADD CONSTRAINT "admin_profile_role_admin_role_key_fk" FOREIGN KEY ("role") REFERENCES "public"."admin_role"("key") ON DELETE no action ON UPDATE no action;