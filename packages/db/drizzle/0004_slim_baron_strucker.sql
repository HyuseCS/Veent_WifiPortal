CREATE TABLE "admin_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_active_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "network_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"uptime_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"users" integer DEFAULT 0 NOT NULL,
	"throughput_mbps" integer DEFAULT 0 NOT NULL,
	"last_sample_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_profile" ADD CONSTRAINT "admin_profile_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;