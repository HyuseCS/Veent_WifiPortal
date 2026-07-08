/**
 * Trend direction for a sparkline series — shared by the Sentry issue rows (the arrow next to each
 * sparkline) and the mobile "top issues" peek (ranking climbers first). Kept out of
 * `$lib/server/*` so client components can import it; pure and unit-tested (see trend.test.ts).
 */

/**
 * Classify a series as rising / falling / flat by comparing its latest bucket to the mean of the
 * earlier ones — robust to a single tail spike, and honest about noise via a dead-band: a change
 * under ±15% reads as flat rather than pretending every wiggle is a trend.
 */
export function trendDirection(series: number[]): 'up' | 'down' | 'flat' {
	const pts = series.filter((n) => Number.isFinite(n));
	if (pts.length < 2) return 'flat';
	const last = pts[pts.length - 1];
	const earlier = pts.slice(0, -1);
	const avg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
	if (avg === 0) return last > 0 ? 'up' : 'flat';
	const change = (last - avg) / avg;
	return change > 0.15 ? 'up' : change < -0.15 ? 'down' : 'flat';
}
