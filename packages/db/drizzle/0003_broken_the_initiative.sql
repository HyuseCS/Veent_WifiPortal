ALTER TABLE "customer_user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "customer_user" ADD COLUMN "phone_number_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "customer_profile" DROP COLUMN "phone_number";--> statement-breakpoint
ALTER TABLE "customer_user" ADD CONSTRAINT "customer_user_phone_number_unique" UNIQUE("phone_number");