-- Live dashboard feed: any write to the dashboard's source tables fires a single
-- NOTIFY on the 'dashboard' channel. The admin process holds one LISTEN
-- connection and re-queries a snapshot per burst (see dashboard-feed.ts).
-- Statement-level (FOR EACH STATEMENT) → one notify per write, not per row.

CREATE OR REPLACE FUNCTION notify_dashboard() RETURNS trigger AS $$
BEGIN
	PERFORM pg_notify('dashboard', '');
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER network_sessions_notify_dashboard
	AFTER INSERT OR UPDATE OR DELETE ON network_sessions
	FOR EACH STATEMENT EXECUTE FUNCTION notify_dashboard();
--> statement-breakpoint
CREATE TRIGGER credit_ledger_notify_dashboard
	AFTER INSERT OR UPDATE OR DELETE ON credit_ledger
	FOR EACH STATEMENT EXECUTE FUNCTION notify_dashboard();
--> statement-breakpoint
CREATE TRIGGER network_health_notify_dashboard
	AFTER INSERT OR UPDATE OR DELETE ON network_health
	FOR EACH STATEMENT EXECUTE FUNCTION notify_dashboard();
