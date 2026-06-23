CREATE TABLE IF NOT EXISTS "payment_checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"package_id" integer NOT NULL,
	"reference_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_transaction_id" text,
	"last_polled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	CONSTRAINT "payment_checkouts_reference_id_unique" UNIQUE("reference_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_checkouts_status_idx" ON "payment_checkouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_checkouts_created_at_idx" ON "payment_checkouts" USING btree ("created_at");