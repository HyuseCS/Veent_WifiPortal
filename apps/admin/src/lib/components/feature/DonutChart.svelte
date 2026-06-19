<script lang="ts">
	import type { PaymentMethodSlice } from '$lib/types';

	let { data, label = 'Revenue by payment method' }: { data: PaymentMethodSlice[]; label?: string } =
		$props();

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
				color: PALETTE[i % PALETTE.length],
				dash: `${frac} ${100 - frac}`,
				// Offset 25 puts the first slice's start at 12 o'clock.
				offset: 25 - cumulative
			};
			cumulative += frac;
			return seg;
		});
	});
</script>

<div class="flex items-center gap-6">
	<svg viewBox="0 0 42 42" class="h-36 w-36 shrink-0" role="img" aria-label={label}>
		<circle cx="21" cy="21" r={R} fill="transparent" stroke="var(--color-border)" stroke-width="4" />
		{#each segments as seg (seg.key)}
			<circle
				cx="21"
				cy="21"
				r={R}
				fill="transparent"
				stroke={seg.color}
				stroke-width="4"
				stroke-dasharray={seg.dash}
				stroke-dashoffset={seg.offset}
			/>
		{/each}
	</svg>

	<ul class="flex min-w-0 flex-1 flex-col gap-2 text-sm">
		{#each segments as seg (seg.key)}
			<li class="flex items-center gap-2">
				<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {seg.color}"></span>
				<span class="truncate text-ink">{seg.label}</span>
				<span class="ml-auto font-mono text-muted">{seg.pct}%</span>
			</li>
		{/each}
		{#if segments.length === 0}
			<li class="text-muted">No settled payments in this period.</li>
		{/if}
	</ul>
</div>
