<script lang="ts">
	import type { ActiveSession, StatusTone } from '$lib/types';
	import { StatusBadge, Table } from '$lib/components/ui';

	let { sessions }: { sessions: ActiveSession[] } = $props();

	const columns = [
		{ label: 'MAC Address' },
		{ label: 'Package' },
		{ label: 'Time Left' },
		{ label: 'Status' }
	];

	// Tick once a second so the countdown moves between SSE snapshots (which only
	// arrive every 5s). The SSE stream still drives which sessions are in the list;
	// this just animates each row's remaining time locally.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const pad = (n: number) => String(n).padStart(2, '0');
	function fmt(ms: number): string {
		const total = Math.max(0, Math.floor(ms / 1000));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
	}

	/** Live time/tone/status from `expiresAt` + the ticking `now`; falls back to the
	 * server snapshot when there's no expiry (mirrors the thresholds in queries.ts). */
	function live(session: ActiveSession): { timeLeft: string; tone: StatusTone; status: string } {
		if (!session.expiresAt) {
			return { timeLeft: session.timeLeft, tone: session.tone, status: session.status };
		}
		const msLeft = new Date(session.expiresAt).getTime() - now;
		if (msLeft <= 0) return { timeLeft: fmt(0), tone: 'blocked', status: 'Expired' };
		if (msLeft < 3 * 60 * 1000) return { timeLeft: fmt(msLeft), tone: 'warning', status: 'Low Time' };
		return { timeLeft: fmt(msLeft), tone: 'online', status: 'Online' };
	}
</script>

<Table {columns}>
	{#each sessions as session, i (i)}
		{@const d = live(session)}
		<tr class="transition-colors hover:bg-surface">
			<td class="px-4 py-3 font-mono text-xs text-ink">{session.mac}</td>
			<td class="px-4 py-3 text-ink">{session.package}</td>
			<td class="px-4 py-3 font-mono text-ink">{d.timeLeft}</td>
			<td class="px-4 py-3">
				<StatusBadge tone={d.tone} label={d.status} />
			</td>
		</tr>
	{/each}
</Table>
