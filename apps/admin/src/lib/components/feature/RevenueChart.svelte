<script lang="ts">
	import type { RevenuePoint } from '$lib/types';

	let {
		data,
		height = 220,
		label = 'Revenue chart'
	}: { data: RevenuePoint[]; height?: number; label?: string } = $props();

	const W = 700;
	const padTop = 12;
	const padBottom = 28;

	const max = $derived(Math.max(1, ...data.map((d) => d.amount)));
	const bars = $derived(
		data.map((d, i) => {
			const slot = W / data.length;
			const bw = slot * 0.55;
			const chartH = height - padTop - padBottom;
			const h = (d.amount / max) * chartH;
			return {
				key: d.label,
				label: d.label,
				x: i * slot + (slot - bw) / 2,
				y: padTop + (chartH - h),
				bw,
				h,
				cx: i * slot + slot / 2
			};
		})
	);
</script>

<svg viewBox="0 0 {W} {height}" class="w-full" role="img" aria-label={label}>
	{#each bars as bar, i (i)}
		<rect x={bar.x} y={bar.y} width={bar.bw} height={bar.h} rx="4" class="fill-brand" />
		<text x={bar.cx} y={height - 8} text-anchor="middle" class="fill-muted text-[12px]">
			{bar.label}
		</text>
	{/each}
</svg>
