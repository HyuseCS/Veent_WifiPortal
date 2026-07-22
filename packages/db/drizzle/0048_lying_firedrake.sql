CREATE TABLE "customer_otp_delivery_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"phone_masked" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "customer_otp_delivery_log_provider_status_created_idx" ON "customer_otp_delivery_log" USING btree ("provider","status","created_at");