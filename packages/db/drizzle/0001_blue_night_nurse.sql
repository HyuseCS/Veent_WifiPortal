CREATE INDEX IF NOT EXISTS "credit_ledger_user_id_idx" ON "credit_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_sessions_user_id_idx" ON "network_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_sessions_mac_address_idx" ON "network_sessions" USING btree ("mac_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_sessions_status_expires_at_idx" ON "network_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_mac_address_idx" ON "rate_limits" USING btree ("mac_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_phone_number_idx" ON "rate_limits" USING btree ("phone_number");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_external_transaction_id_unique" UNIQUE("external_transaction_id"); EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;