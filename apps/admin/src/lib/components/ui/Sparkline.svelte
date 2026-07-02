<script lang="ts">
	import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';
	import ArrowDownRight from 'lucide-svelte/icons/arrow-down-right';
	import Minus from 'lucide-svelte/icons/minus';
	import { trendDirection } from '$lib/trend';

	// Tiny dependency-free trend sparkline for a data row (Sentry issues). Deliberately monochrome
	// (inherits the row's muted `currentColor`, no red/green) so it doesn't compete with the level
	// StatusBadge; direction is carried by the trailing arrow + an sr-only phrase, never colour
	// alone. Empty/flat series render an honest centred baseline rather than nothing.
	let {
		values,
		label = '',
		window: win = '14 days'
	}: { values: number[]; label?: string; window?: string } = $props();

	const W = 64;
	const H = 20;
	const PAD = 2;

	const dir = $derived(trendDirection(values));

	const geom = $derived.by(() => {
		const v = values.filter((n) => Number.isFinite(n));
		if (v.length === 0) return null;
		const min = Math.min(...v);
		const max = Math.max(...v);
		const span = max - min;
		const n = v.length;
		const xy = (val: number, i: number) => ({
			x: n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD),
			// Flat series (span 0) sits on the centre line; otherwise higher count = higher on screen.
			y: span === 0 ? H / 2 : PAD + (1 - (val - min) / span) * (H - 2 * PAD)
		});
		const pts = v.map(xy);
		const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
		return { d, last: pts[pts.length - 1] };
	});

	const dirLabel = $derived(dir === 'up' ? 'trending up' : dir === 'down' ? 'trending down' : 'steady');
	const Arrow = $derived(dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus);
</script>

<span class="inline-flex items-center gap-1.5 text-muted" title="{dirLabel} over {win}">
	<svg viewBox="0 0 {W} {H}" class="h-5 w-16 shrink-0 overflow-visible" aria-hidden="true">
		{#if geom}
			<path
				d={geom.d}
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				opacity="0.7"
			/>
			<circle cx={geom.last.x} cy={geom.last.y} r="1.75" fill="currentColor" />
		{:else}
			<line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3" opacity="0.4" />
		{/if}
	</svg>
	<Arrow class="h-3 w-3 shrink-0" aria-hidden="true" />
	<span class="sr-only">{label ? `${label}: ` : ''}{dirLabel} over {win}</span>
</span>
