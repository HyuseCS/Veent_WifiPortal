ALTER TABLE "customer_user" ADD COLUMN IF NOT EXISTS "phone_number" text;--> statement-breakpoint
ALTER TABLE "customer_user" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "customer_profile" DROP COLUMN IF EXISTS "phone_number";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "customer_user" ADD CONSTRAINT "customer_user_phone_number_unique" UNIQUE("phone_number"); EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;