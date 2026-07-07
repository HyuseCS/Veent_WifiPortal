<script lang="ts">
	import type { PaymentMethodSlice } from '$lib/types';

	// `centerValue`/`centerLabel` fill the donut hole with a headline total (e.g. settled
	// revenue) — both optional so existing callers render the plain ring unchanged.
	// `compact` is the narrow-column variant (2-up donut cards on mobile/tablet): smaller ring,
	// donut always stacked over a 2-line legend so the ₱ amount never truncates. Center total is
	// kept but sized down to fit the 112px ring.
	let {
		data,
		label = 'Revenue by payment method',
		centerValue,
		centerLabel,
		compact = false
	}: {
		data: PaymentMethodSlice[];
		label?: string;
		centerValue?: string;
		centerLabel?: string;
		compact?: boolean;
	} = $props();

	const peso = (n: number) => `₱${n.toLocaleString('en-PH')}`;

	// Token-backed palette (cycled if there are more slices than colors).
	const PALETTE = [
		'var(--color-brand)',
		'var(--color-online)',
		'var(--color-warning)',
		'var(--color-blocked)',
		'var(--color-muted)'
	];

	// r chosen so the circumference is 100 — slice fractions map straight to dasharray.
	const R = 15.91549431;

	const total = $derived(data.reduce((sum, s) => sum + s.amount, 0));
	const segments = $derived.by(() => {
		let cumulative = 0;
		return data.map((s, i) => {
			const frac = total > 0 ? (s.amount / total) * 100 : 0;
			const seg = {
				key: s.type,
				label: s.label,
				pct: s.pct,
				amount: s.amount,
				color: PALETTE[i % PALETTE.length],
				dash: `${frac} ${100 - frac}`,
				// Offset 25 puts the first slice's start at 12 o'clock.
				offset: 25 - cumulative
			};
			cumulative += frac;
			return seg;
		});
	});

	// Hover: highlight a slice (from the ring OR its legend row) and surface its value in the
	// donut's center hole — which otherwise shows the settled total. Reverts on leave/blur, so
	// the center doubles as the tooltip and we avoid positioning a floating card in the tiny box.
	let hovered: number | null = $state(null);
	const active = $derived(hovered !== null ? segments[hovered] : null);
</script>

<!-- Row on sm+; stacks (donut over legend) on phones so the legend gets full width.
     compact: always a centered column (donut over legend) for narrow 2-up cards. -->
<div class="flex {compact ? 'flex-col items-center gap-3' : 'items-center gap-6 max-sm:flex-col'}">
	<div class="relative shrink-0 {compact ? 'h-28 w-28' : 'h-36 w-36'}">
		<svg viewBox="0 0 42 42" class="h-full w-full" role="img" aria-label={label}>
			<circle
				cx="21"
				cy="21"
				r={R}
				fill="transparent"
				stroke="var(--color-border)"
				stroke-width="4"
				class="pointer-events-none"
			/>
			{#each segments as seg, i (seg.key)}
				<!-- fill:none + pointer-events:stroke (in <style>) so only the visible arc is
				     hittable — not the whole disc — giving per-slice hover. role/title carry the
				     accessible value; focus mirrors hover for keyboard users. -->
				<circle
					class="donut-seg"
					class:is-dim={hovered !== null && hovered !== i}
					cx="21"
					cy="21"
					r={R}
					fill="none"
					stroke={seg.color}
					stroke-width={hovered === i ? 5 : 4}
					stroke-dasharray={seg.dash}
					stroke-dashoffset={seg.offset}
					role="button"
					tabindex="0"
					aria-label="{seg.label}: {peso(seg.amount)} ({seg.pct}%)"
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
					onfocus={() => (hovered = i)}
					onblur={() => (hovered = null)}
				>
					<title>{seg.label}: {peso(seg.amount)} ({seg.pct}%)</title>
				</circle>
			{/each}
		</svg>
		{#if centerValue || active}
			<div
				class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-1 text-center leading-none"
			>
				{#if active}
					<!-- Hovered slice takes over the hole as the tooltip. -->
					<span class="font-mono {compact ? 'text-sm' : 'text-base'} font-bold tracking-tight text-ink"
						>{peso(active.amount)}</span
					>
					<span class="mt-1 flex items-center gap-1 {compact ? 'text-[9px]' : 'text-[10px]'} font-semibold text-muted">
						<span class="inline-block h-2 w-2 shrink-0 rounded-full" style="background: {active.color}"></span>
						<span class="max-w-[9ch] truncate text-ink">{active.label}</span>
						<span>· {active.pct}%</span>
					</span>
				{:else}
					<span
						class="font-mono {compact
							? 'text-sm'
							: 'text-lg'} font-bold tracking-tight text-ink">{centerValue}</span
					>
					{#if centerLabel}
						<span
							class="mt-1 {compact
								? 'text-[9px]'
								: 'text-[10px]'} font-semibold tracking-wide text-muted uppercase">{centerLabel}</span
						>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<ul
		class="flex flex-col text-sm {compact
			? 'w-full gap-1.5'
			: 'min-w-0 flex-1 gap-2 max-sm:w-full'}"
	>
		{#each segments as seg, i (seg.key)}
			{#if compact}
				<!-- 2-line item: dot+label+pct on top, ₱ amount under (full width fits without truncating). -->
				<li
					class="-mx-1.5 rounded-md px-1.5 leading-tight transition-colors"
					class:bg-surface={hovered === i}
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
				>
					<div class="flex items-center gap-1.5">
						<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {seg.color}"></span>
						<span class="min-w-0 flex-1 truncate text-ink">{seg.label}</span>
						<span class="shrink-0 font-mono text-xs font-semibold text-ink">{seg.pct}%</span>
					</div>
					<span class="block pl-[18px] font-mono text-xs text-muted">{peso(seg.amount)}</span>
				</li>
			{:else}
				<li
					class="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors"
					class:bg-surface={hovered === i}
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
				>
					<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {seg.color}"></span>
					<span class="truncate text-ink">{seg.label}</span>
					<span class="ml-auto font-mono text-xs text-muted">{peso(seg.amount)}</span>
					<span class="w-10 text-right font-mono font-semibold text-ink">{seg.pct}%</span>
				</li>
			{/if}
		{/each}
		{#if segments.length === 0}
			<li class="text-muted">No settled payments in this period.</li>
		{/if}
	</ul>
</div>

<style>
	/* Hit-test only the painted arc (not the whole transparent disc) so each slice hovers
	   independently; browsers honour the dash gaps for stroke hit-testing. */
	.donut-seg {
		pointer-events: stroke;
		cursor: pointer;
		outline: none;
		transition:
			opacity 120ms ease-out,
			stroke-width 120ms ease-out;
	}
	.donut-seg.is-dim {
		opacity: 0.4;
	}
</style>
