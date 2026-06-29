CREATE TABLE IF NOT EXISTS "faqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "faqs_sort_order_idx" ON "faqs" USING btree ("sort_order");
--> statement-breakpoint
-- Seed the FAQ content that previously lived hardcoded in customer faq/+page.svelte, so the
-- Help page isn't empty after switching to the DB-backed source. Idempotent (per-question
-- NOT EXISTS guard) so it never duplicates if the table already holds these entries.
INSERT INTO "faqs" ("question", "answer", "sort_order")
SELECT 'How does my time work?', 'Your internet time belongs to your account, not to one device. Buy a tier or claim free time once, and it counts down for your whole account — you can use it from your phone and your laptop without paying again.', 1
WHERE NOT EXISTS (SELECT 1 FROM "faqs" WHERE "question" = 'How does my time work?');--> statement-breakpoint
INSERT INTO "faqs" ("question", "answer", "sort_order")
SELECT 'Why do I see extra devices?', 'iPhones and Macs use a private Wi-Fi address that can change — for example after a software update or if you toggle Wi-Fi settings. When that happens your phone can show up as a new device. It''s safe to remove the oldest one; we''ll reconnect your phone automatically next time it joins.', 2
WHERE NOT EXISTS (SELECT 1 FROM "faqs" WHERE "question" = 'Why do I see extra devices?');--> statement-breakpoint
INSERT INTO "faqs" ("question", "answer", "sort_order")
SELECT 'What is the device limit?', 'Your account can be connected on a limited number of devices at once. If you reach the limit, connecting a new device replaces the one you''ve used least recently. You can also remove devices yourself below your access timer.', 3
WHERE NOT EXISTS (SELECT 1 FROM "faqs" WHERE "question" = 'What is the device limit?');--> statement-breakpoint
INSERT INTO "faqs" ("question", "answer", "sort_order")
SELECT 'How often do I get free time?', 'Free time is one short session for your whole account, available again every 12 hours. It is shared across your devices — claiming it on one device uses it for the account.', 4
WHERE NOT EXISTS (SELECT 1 FROM "faqs" WHERE "question" = 'How often do I get free time?');--> statement-breakpoint
INSERT INTO "faqs" ("question", "answer", "sort_order")
SELECT 'I lost a device — how do I disconnect it?', 'On your dashboard, open "Your devices" and use "Disconnect all". That drops every device from your account immediately; reconnect the ones you still have by opening the portal on each.', 5
WHERE NOT EXISTS (SELECT 1 FROM "faqs" WHERE "question" = 'I lost a device — how do I disconnect it?');
