CREATE TABLE IF NOT EXISTS "admin_owner_change_approval" (
	"request_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_owner_change_approval_request_id_owner_id_pk" PRIMARY KEY("request_id","owner_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_owner_change_request" (
	"id" text PRIMARY KEY NOT NULL,
	"target_user_id" text NOT NULL,
	"action" text NOT NULL,
	"initiated_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "admin_owner_change_approval" ADD CONSTRAINT "admin_owner_change_approval_request_id_admin_owner_change_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."admin_owner_change_request"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "admin_owner_change_approval" ADD CONSTRAINT "admin_owner_change_approval_owner_id_admin_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "admin_owner_change_request" ADD CONSTRAINT "admin_owner_change_request_target_user_id_admin_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "admin_owner_change_request" ADD CONSTRAINT "admin_owner_change_request_initiated_by_admin_user_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "owner_change_one_pending_per_target" ON "admin_owner_change_request" USING btree ("target_user_id") WHERE "admin_owner_change_request"."status" = 'pending';
