<script lang="ts">
	import type { PaymentMethodSlice } from '$lib/types';

	// `centerValue`/`centerLabel` fill the donut hole with a headline total (e.g. settled
	// revenue) — both optional so existing callers render the plain ring unchanged.
	let {
		data,
		label = 'Revenue by payment method',
		centerValue,
		centerLabel
	}: {
		data: PaymentMethodSlice[];
		label?: string;
		centerValue?: string;
		centerLabel?: string;
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
</script>

<div class="flex items-center gap-6">
	<div class="relative h-36 w-36 shrink-0">
		<svg viewBox="0 0 42 42" class="h-full w-full" role="img" aria-label={label}>
			<circle
				cx="21"
				cy="21"
				r={R}
				fill="transparent"
				stroke="var(--color-border)"
				stroke-width="4"
			/>
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
		{#if centerValue}
			<div
				class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center leading-none"
			>
				<span class="font-mono text-lg font-bold tracking-tight text-ink">{centerValue}</span>
				{#if centerLabel}
					<span class="mt-1 text-[10px] font-semibold tracking-wide text-muted uppercase"
						>{centerLabel}</span
					>
				{/if}
			</div>
		{/if}
	</div>

	<ul class="flex min-w-0 flex-1 flex-col gap-2 text-sm">
		{#each segments as seg (seg.key)}
			<li class="flex items-center gap-2">
				<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {seg.color}"></span>
				<span class="truncate text-ink">{seg.label}</span>
				<span class="ml-auto font-mono text-xs text-muted">{peso(seg.amount)}</span>
				<span class="w-10 text-right font-mono font-semibold text-ink">{seg.pct}%</span>
			</li>
		{/each}
		{#if segments.length === 0}
			<li class="text-muted">No settled payments in this period.</li>
		{/if}
	</ul>
</div>
