CREATE TABLE IF NOT EXISTS "customer_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "customer_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "admin_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"package_id" integer,
	"amount" double precision NOT NULL,
	"type" text NOT NULL,
	"external_transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"phone_number" text,
	"credit_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"last_free_session_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"mac_address" text,
	"user_id" text NOT NULL,
	"package_id" integer,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"fiat_cost" double precision,
	"credits_provided" integer,
	"credit_cost" integer,
	"duration_minutes" integer,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"mac_address" text,
	"phone_number" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "customer_account" ADD CONSTRAINT "customer_account_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "customer_session" ADD CONSTRAINT "customer_session_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "admin_account" ADD CONSTRAINT "admin_account_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "customer_profile" ADD CONSTRAINT "customer_profile_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "network_sessions" ADD CONSTRAINT "network_sessions_user_id_customer_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "network_sessions" ADD CONSTRAINT "network_sessions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;