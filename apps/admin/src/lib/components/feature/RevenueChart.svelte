<script lang="ts">
	import type { RevenuePoint } from '$lib/types';

	let {
		data,
		height = 220,
		label = 'Revenue chart'
	}: { data: RevenuePoint[]; height?: number; label?: string } = $props();

	// Dependency-free SVG area+line chart (same no-dep philosophy as DonutChart). One real
	// series — `amount` per bucket; the design mockup's dashed "credits sold" comparison line
	// is intentionally omitted (no second series exists in the data).
	const W = 700;
	const padLeft = 46;
	const padRight = 14;
	const padTop = 20;
	const padBottom = 26;

	// Stable gradient/clip id derived from the label so two charts on a page never collide
	// and SSR/client markup matches (no Math.random).
	const uid = $derived(label.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase());

	/** Round a raw max up to a clean axis ceiling (1/2/2.5/5/10 × 10ⁿ). */
	function niceCeil(v: number): number {
		if (v <= 0) return 1;
		const pow = Math.pow(10, Math.floor(Math.log10(v)));
		const n = v / pow;
		const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
		return step * pow;
	}

	/** Compact peso label for the Y axis (₱10k, ₱7.5k, ₱500). */
	function fmtPeso(n: number): string {
		if (n >= 1000) {
			const k = n / 1000;
			return `₱${Number.isInteger(k) ? k : Number(k.toFixed(1))}k`;
		}
		return `₱${Math.round(n)}`;
	}

	// Container-driven height: the chart fills whatever card it sits in (tall stacked
	// card, short two-column card, …) instead of a fixed aspect ratio. We measure the
	// wrapper and set the viewBox height so its aspect matches the box exactly — then
	// `meet` fills it with no letterboxing / dead space. `height` is the SSR /
	// pre-measure fallback; 120 is a floor so a short card never collapses the plot.
	let wrapW = $state(0);
	let wrapH = $state(0);
	const H = $derived(wrapW > 0 && wrapH > 0 ? Math.max(120, (W * wrapH) / wrapW) : height);

	const plotW = W - padLeft - padRight;
	const plotH = $derived(H - padTop - padBottom);
	const baseline = $derived(padTop + plotH);

	const max = $derived(niceCeil(Math.max(0, ...data.map((d) => d.amount))));
	const STEPS = 4;
	const ticks = $derived(Array.from({ length: STEPS + 1 }, (_, i) => (max / STEPS) * (STEPS - i)));

	const pts = $derived(
		data.map((d, i) => ({
			label: d.label,
			amount: d.amount,
			x: data.length <= 1 ? padLeft + plotW / 2 : padLeft + (i / (data.length - 1)) * plotW,
			y: padTop + plotH * (1 - d.amount / max)
		}))
	);

	/** Catmull-Rom → cubic-bézier smoothing (tension 1/6) for a soft curve. */
	const linePath = $derived.by(() => {
		if (pts.length === 0) return '';
		if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
		let d = `M ${pts[0].x} ${pts[0].y}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] ?? pts[i];
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const p3 = pts[i + 2] ?? p2;
			const cp1x = p1.x + (p2.x - p0.x) / 6;
			const cp1y = p1.y + (p2.y - p0.y) / 6;
			const cp2x = p2.x - (p3.x - p1.x) / 6;
			const cp2y = p2.y - (p3.y - p1.y) / 6;
			d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
		}
		return d;
	});
	const areaPath = $derived(
		pts.length
			? `${linePath} L ${pts[pts.length - 1].x} ${baseline} L ${pts[0].x} ${baseline} Z`
			: ''
	);

	// Peak point gets a value callout, clamped horizontally so the bubble stays in-frame.
	const peak = $derived.by(() => {
		if (!pts.length) return null;
		let best = pts[0];
		for (const p of pts) if (p.amount > best.amount) best = p;
		return best;
	});
	const peakLabel = $derived(peak ? `₱${peak.amount.toLocaleString('en-PH')}` : '');
	const bubbleW = $derived(Math.max(46, peakLabel.length * 8 + 16));
	const bubbleX = $derived(
		peak ? Math.min(Math.max(peak.x - bubbleW / 2, padLeft), W - padRight - bubbleW) : 0
	);

	// --- Hover tooltip ---------------------------------------------------------
	// Custom SVG chart → tooltip is plain Svelte state driven by pointer/focus on
	// transparent hit-circles. Position is measured from each hit-circle's real
	// screen rect relative to the wrapper, so it stays aligned regardless of the
	// SVG's viewBox scaling / letterboxing. Reads only the existing `pts` data —
	// `RevenuePoint` carries no credits/session counts, so none are shown.
	let wrapperEl: HTMLDivElement | undefined = $state();
	let hovered: number | null = $state(null);
	// Kept past hide so content stays put while the card fades out.
	let lastIdx = $state(0);
	let tipLeft = $state(0);
	let tipTop = $state(0);
	let tipW = $state(0);

	const shown = $derived(hovered !== null);
	const tip = $derived(pts.length ? pts[Math.min(lastIdx, pts.length - 1)] : null);
	// Flip below the point when there isn't room above for the card.
	const below = $derived(tipTop < 72);
	// Clamp horizontally so the card never spills past the chart card edges.
	const tipX = $derived.by(() => {
		const half = tipW / 2;
		const min = half + 6;
		const max = wrapW - half - 6;
		if (!wrapW || max < min) return tipLeft;
		return Math.min(Math.max(tipLeft, min), max);
	});

	function showTip(i: number, e: Event) {
		const wrap = wrapperEl?.getBoundingClientRect();
		const r = (e.currentTarget as Element).getBoundingClientRect();
		if (!wrap) return;
		hovered = i;
		lastIdx = i;
		tipLeft = r.left + r.width / 2 - wrap.left;
		tipTop = r.top + r.height / 2 - wrap.top;
	}
	function hideTip() {
		hovered = null;
	}
</script>

<div
	class="relative h-full w-full"
	bind:this={wrapperEl}
	bind:clientWidth={wrapW}
	bind:clientHeight={wrapH}
>
	<svg
		viewBox="0 0 {W} {H}"
		preserveAspectRatio="xMidYMid meet"
		class="h-full max-h-full w-full text-brand"
		role="img"
		aria-label={label}
	>
		<defs>
			<linearGradient id="rev-fill-{uid}" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="currentColor" stop-opacity="0.2" />
				<stop offset="100%" stop-color="currentColor" stop-opacity="0" />
			</linearGradient>
		</defs>

		<!-- Y gridlines + peso labels -->
		{#each ticks as tick, i (tick)}
			{@const y = padTop + (plotH / STEPS) * i}
			<line x1={padLeft} y1={y} x2={W - padRight} y2={y} class="stroke-border" stroke-width="1" />
			<text x={padLeft - 8} {y} dy="3.5" text-anchor="end" class="fill-muted text-[11px]">
				{fmtPeso(tick)}
			</text>
		{/each}

		{#if pts.length}
			<!-- Area + line (entrance: line draws on, area fades in just behind it) -->
			<path class="chart-area" d={areaPath} fill="url(#rev-fill-{uid})" />
			<path
				class="chart-line"
				d={linePath}
				pathLength="1"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>

			<!-- Data points: settle in after the line; hover grows the dot. -->
			{#each pts as p (p.label)}
				<circle
					class="chart-dot"
					cx={p.x}
					cy={p.y}
					r="3"
					fill="var(--color-bg)"
					stroke="currentColor"
					stroke-width="2"
				/>
			{/each}

			<!-- Hovered/focused bucket: vertical guide + emphasized ring. -->
			{#if hovered !== null && pts[hovered]}
				{@const ap = pts[hovered]}
				<line
					x1={ap.x}
					y1={padTop}
					x2={ap.x}
					y2={baseline}
					class="stroke-border"
					stroke-width="1"
					stroke-dasharray="3 3"
				/>
				<circle
					cx={ap.x}
					cy={ap.y}
					r="5"
					fill="var(--color-bg)"
					stroke="currentColor"
					stroke-width="2.5"
				/>
			{/if}

			<!-- X labels -->
			{#each pts as p (p.label)}
				<text x={p.x} y={H - 8} text-anchor="middle" class="fill-muted text-[12px]"
					>{p.label}</text
				>
			{/each}

			<!-- Transparent hit-targets: enlarge the hover/focus area and carry the
		     accessible per-bucket label. Drive the floating tooltip via pointer
		     and keyboard focus. -->
			{#each pts as p, i (p.label)}
				<circle
					class="chart-hit"
					cx={p.x}
					cy={p.y}
					r="16"
					fill="transparent"
					role="button"
					tabindex="0"
					aria-label="{p.label}: ₱{p.amount.toLocaleString('en-PH')}"
					onpointerenter={(e) => showTip(i, e)}
					onpointermove={(e) => showTip(i, e)}
					onpointerleave={hideTip}
					onfocus={(e) => showTip(i, e)}
					onblur={hideTip}
				>
					<title>{p.label}: ₱{p.amount.toLocaleString('en-PH')}</title>
				</circle>
			{/each}

			<!-- Peak value callout (hidden while a hover tooltip is showing). -->
			{#if peak && hovered === null}
				<g class="chart-callout">
					<rect
						x={bubbleX}
						y={Math.max(peak.y - 28, 2)}
						width={bubbleW}
						height="20"
						rx="6"
						class="fill-ink"
					/>
					<text
						x={bubbleX + bubbleW / 2}
						y={Math.max(peak.y - 28, 2) + 14}
						text-anchor="middle"
						class="fill-bg text-[11px] font-semibold"
					>
						{peakLabel}
					</text>
				</g>
			{/if}
		{/if}
	</svg>

	<!-- Floating tooltip — HTML overlay so it gets a real surface/shadow and theme
	     tokens, positioned in pixel space over the responsive SVG. Visual only
	     (aria-hidden); the SVG hit-circles carry the accessible labels. -->
	{#if tip}
		<div
			class="tip"
			class:is-shown={shown}
			class:below
			style="left: {tipX}px; top: {tipTop}px;"
			bind:clientWidth={tipW}
			aria-hidden="true"
		>
			<div class="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg shadow-black/10">
				<div class="text-[11px] font-medium uppercase tracking-wide text-muted">{tip.label}</div>
				<div class="font-mono text-base font-bold text-ink">
					₱{tip.amount.toLocaleString('en-PH')}
				</div>
			</div>
			<span class="tip-caret border-border bg-surface"></span>
		</div>
	{/if}
</div>

<style>
	.chart-hit {
		cursor: pointer;
		outline: none;
	}

	/* Fade + scale, CSS-driven so the global prefers-reduced-motion block
	   (layout.css) collapses the duration automatically. */
	.tip {
		position: absolute;
		z-index: 10;
		pointer-events: none;
		opacity: 0;
		transform: translate(-50%, calc(-100% - 12px)) scale(0.92);
		transform-origin: bottom center;
		transition:
			opacity 140ms ease-out,
			transform 140ms ease-out;
	}
	.tip.below {
		transform: translate(-50%, 12px) scale(0.92);
		transform-origin: top center;
	}
	.tip.is-shown {
		opacity: 1;
		transform: translate(-50%, calc(-100% - 12px)) scale(1);
	}
	.tip.below.is-shown {
		transform: translate(-50%, 12px) scale(1);
	}

	/* Small caret rendered as a rotated square sharing the card's surface + border. */
	.tip-caret {
		position: absolute;
		left: 50%;
		bottom: -4px;
		height: 8px;
		width: 8px;
		transform: translateX(-50%) rotate(45deg);
		border-right-width: 1px;
		border-bottom-width: 1px;
		border-style: solid;
	}
	.tip.below .tip-caret {
		bottom: auto;
		top: -4px;
		border-right-width: 0;
		border-bottom-width: 0;
		border-top-width: 1px;
		border-left-width: 1px;
	}
</style>
