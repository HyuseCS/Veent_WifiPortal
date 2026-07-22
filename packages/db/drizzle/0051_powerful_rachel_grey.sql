ALTER TABLE "credit_ledger" ADD COLUMN "ap_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "network_sessions" ADD COLUMN "ap_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD COLUMN "ap_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD COLUMN "ap_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD COLUMN "ap_name_snapshot" text;