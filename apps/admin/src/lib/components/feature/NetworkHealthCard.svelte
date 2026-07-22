<script lang="ts">
	import Wifi from 'lucide-svelte/icons/wifi';
	import type { NetworkAp } from '$lib/types';
	import { StatusBadge } from '$lib/components/ui';

	// Compact per-AP summary. The whole card is a button that opens the full detail modal
	// (all details + owner controls + the operator display-name editor). `selected` rings the
	// card to mirror the coverage-map focus.
	type GroupMember = { name: string; tone: 'online' | 'warning' | 'blocked'; status: string };
	let {
		ap,
		group,
		selected = false,
		onopen
	}: {
		ap: NetworkAp;
		/** Shared-ONU group members (2+ APs the router can't split): when set, this card represents
		 * the whole group and lists each member's own up/down. Undefined for a solo AP. */
		group?: { members: GroupMember[] };
		selected?: boolean;
		onopen?: (ap: NetworkAp) => void;
	} = $props();

	// Per-AP traffic is genuinely unavailable when the firmware hides byte counters ("—").
	const trafficUnavailable = $derived(ap.throughput === '—');

	// tone → token classes for the status icon tile + accents.
	const toneIcon: Record<string, string> = {
		online: 'bg-online/10 text-online',
		warning: 'bg-warning/10 text-warning',
		blocked: 'bg-blocked/10 text-blocked'
	};
	const toneBar: Record<string, string> = {
		online: 'bg-online',
		warning: 'bg-warning',
		blocked: 'bg-blocked'
	};

	// Pull the leading number out of a pre-formatted metric string ("47 Mbps", "22ms").
	const num = (s: string): number => {
		const n = parseFloat(s);
		return Number.isFinite(n) ? n : NaN;
	};

	// Uplink load as a share of a 120 Mbps reference, for the bar + caption.
	const loadPct = $derived.by(() => {
		const t = num(ap.throughput);
		return Number.isFinite(t) ? Math.min(100, Math.round((t / 120) * 100)) : 0;
	});

	// Latency colour bands, independent of overall status.
	const latColor = $derived.by(() => {
		const l = num(ap.latency);
		if (!Number.isFinite(l)) return 'text-muted';
		if (l < 20) return 'text-online';
		if (l < 40) return 'text-warning';
		return 'text-blocked';
	});

	const metrics = $derived([
		{ label: 'Uptime', value: ap.uptime, class: 'text-ink', title: undefined as string | undefined },
		{ label: 'Latency', value: ap.latency, class: latColor, title: undefined as string | undefined },
		{ label: 'Users', value: String(ap.users), class: 'text-ink', title: undefined as string | undefined },
		{
			label: 'Tput',
			value: ap.throughput,
			class: trafficUnavailable ? 'text-muted' : 'text-ink',
			title: trafficUnavailable ? 'Per-AP traffic unavailable on this firmware' : undefined
		}
	]);
</script>

<div
	role="button"
	tabindex="0"
	onclick={() => onopen?.(ap)}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onopen?.(ap);
		}
	}}
	class="flex cursor-pointer flex-col gap-4 rounded-xl border bg-bg p-4.5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-brand/60 hover:shadow-md {selected
		? 'border-[1.5px] border-brand'
		: 'border-border'}"
>
	<div class="flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-3">
			<span
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {toneIcon[ap.tone]}"
				aria-hidden="true"
			>
				<Wifi class="h-4.5 w-4.5" />
			</span>
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold text-ink">{ap.name}</div>
				{#if ap.mac}
					<div class="truncate font-mono text-xs text-muted">{ap.mac}</div>
				{/if}
				{#if ap.address}
					<div class="truncate text-xs text-muted">{ap.address}</div>
				{/if}
			</div>
		</div>
		<StatusBadge tone={ap.tone} label={ap.status} pulse={ap.tone !== 'online'} />
	</div>

	{#if group}
		<!-- Shared-ONU group: the router can't split these APs (they answer on one ONU/circuit-id),
		     so we show them honestly as one card with each member's own up/down. -->
		<div class="flex flex-col gap-2 rounded-lg border border-border/70 bg-surface/40 p-2.5">
			<p class="text-[11px] font-medium text-muted">
				Shared ONU — the router cannot split these {group.members.length} APs.
			</p>
			<ul class="flex flex-col gap-1.5">
				{#each group.members as m (m.name)}
					<li class="flex items-center justify-between gap-2">
						<span class="min-w-0 truncate text-xs font-medium text-ink">{m.name}</span>
						<StatusBadge tone={m.tone} label={m.status} pulse={m.tone !== 'online'} />
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<dl class="grid grid-cols-2 gap-2 border-y border-border py-3 text-center sm:grid-cols-4">
		{#each metrics as metric (metric.label)}
			<div class="flex flex-col gap-1">
				<dt class="text-[10px] font-bold tracking-wide text-muted uppercase">{metric.label}</dt>
				<dd class="font-mono text-sm font-semibold {metric.class}" title={metric.title}>{metric.value}</dd>
			</div>
		{/each}
	</dl>

	<div class="flex flex-col gap-1.5">
		<div class="flex items-center justify-between">
			<span class="text-xs font-medium text-muted">Uplink load</span>
			<span class="font-mono text-xs font-medium text-muted">{loadPct}%</span>
		</div>
		<div class="h-1.5 overflow-hidden rounded bg-surface">
			<div class="h-full rounded {toneBar[ap.tone]}" style="width: {loadPct}%"></div>
		</div>
	</div>
</div>
