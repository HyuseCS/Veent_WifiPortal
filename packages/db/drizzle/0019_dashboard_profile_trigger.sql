-- Live dashboard feed: also fire the 'dashboard' NOTIFY on customer_profile writes.
-- The admin Users page reads the shared dashboard snapshot, and some user changes touch
-- ONLY the profile row — block/unblock (blocked), pause/resume (access_paused_at), and
-- access-window edits (access_expires_at / access_package_id). Balance changes already
-- fire via credit_ledger and online/offline via network_sessions; this closes the gap so
-- a profile-only change still pushes live. Reuses notify_dashboard() from 0006.
-- Idempotent: DROP IF EXISTS then CREATE, so it no-ops if already applied.
DROP TRIGGER IF EXISTS customer_profile_notify_dashboard ON customer_profile;--> statement-breakpoint
CREATE TRIGGER customer_profile_notify_dashboard
	AFTER INSERT OR UPDATE OR DELETE ON customer_profile
	FOR EACH STATEMENT EXECUTE FUNCTION notify_dashboard();
