CREATE TABLE "points_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"package_id" integer,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"external_transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_external_transaction_id_unique" UNIQUE("external_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "points_earn_rate" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profile" ADD COLUMN "points_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "points_cost" integer;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "points_ledger_user_id_idx" ON "points_ledger" USING btree ("user_id");