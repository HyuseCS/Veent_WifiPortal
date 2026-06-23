CREATE TABLE IF NOT EXISTS "payment_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"fund_source_type" text,
	"fund_source_masked" text,
	"receipt_no" text,
	"reference_no" text,
	"error_code" text,
	"error_message" text,
	"buyer_name" text,
	"buyer_email" text,
	"user_id" text,
	"package_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_user_id_idx" ON "payment_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_created_at_idx" ON "payment_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_status_idx" ON "payment_transactions" USING btree ("status");