ALTER TABLE "customer_profile" ADD COLUMN IF NOT EXISTS "last_network_id" integer;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD COLUMN IF NOT EXISTS "network_id" integer;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "network_id" integer;