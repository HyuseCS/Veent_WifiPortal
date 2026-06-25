ALTER TABLE "customer_profile" ADD COLUMN "last_network_id" integer;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD COLUMN "network_id" integer;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "network_id" integer;