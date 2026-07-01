-- Per-ACCOUNT live feed for the customer dashboard. Any write to a table that
-- affects one account's dashboard fires a NOTIFY on the 'account' channel carrying
-- the affected user_id as the payload, so the customer app can push the update to
-- only that account's open SSE streams (see apps/customer/.../account-feed.ts).
--
-- FOR EACH ROW (not statement) so the trigger can read the row's user_id; a burst
-- of row writes for one account (e.g. unbinding several devices) is coalesced by a
-- per-user debounce in the feed. Distinct from the admin's statement-level, empty-
-- payload 'dashboard' channel (migration 0006), which broadcasts globally.

CREATE OR REPLACE FUNCTION notify_account() RETURNS trigger AS $$
DECLARE
	uid text;
BEGIN
	uid := COALESCE(NEW.user_id, OLD.user_id);
	IF uid IS NOT NULL THEN
		PERFORM pg_notify('account', uid);
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS customer_profile_notify_account ON customer_profile;--> statement-breakpoint
CREATE TRIGGER customer_profile_notify_account
	AFTER INSERT OR UPDATE OR DELETE ON customer_profile
	FOR EACH ROW EXECUTE FUNCTION notify_account();
--> statement-breakpoint
DROP TRIGGER IF EXISTS network_sessions_notify_account ON network_sessions;--> statement-breakpoint
CREATE TRIGGER network_sessions_notify_account
	AFTER INSERT OR UPDATE OR DELETE ON network_sessions
	FOR EACH ROW EXECUTE FUNCTION notify_account();
--> statement-breakpoint
DROP TRIGGER IF EXISTS credit_ledger_notify_account ON credit_ledger;--> statement-breakpoint
CREATE TRIGGER credit_ledger_notify_account
	AFTER INSERT OR UPDATE OR DELETE ON credit_ledger
	FOR EACH ROW EXECUTE FUNCTION notify_account();
