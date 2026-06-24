<script lang="ts">
	/**
	 * Tiny inline-SVG icon set (Lucide geometry) for the customer portal. Kept
	 * dependency-free to honour the ultra-lightweight portal — no icon package is
	 * pulled into the captive-browser bundle. `stroke="currentColor"` means colour
	 * follows the `text-*` utility on the element.
	 */
	type IconName =
		| 'wifi'
		| 'clock'
		| 'arrow-right'
		| 'arrow-left'
		| 'chevron-right'
		| 'lock'
		| 'check'
		| 'plus'
		| 'log-out'
		| 'alert-circle'
		| 'alert-triangle'
		| 'pause'
		| 'play';

	let {
		name,
		size = 20,
		strokeWidth = 2,
		class: klass = ''
	}: { name: IconName; size?: number; strokeWidth?: number; class?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={klass}
	aria-hidden="true"
>
	{#if name === 'wifi'}
		<path d="M5 13a10 10 0 0 1 14 0" />
		<path d="M8.5 16.5a5 5 0 0 1 7 0" />
		<path d="M2 8.82a15 15 0 0 1 20 0" />
		<line x1="12" y1="20" x2="12.01" y2="20" />
	{:else if name === 'clock'}
		<circle cx="12" cy="12" r="9" />
		<polyline points="12 7 12 12 15.5 13.5" />
	{:else if name === 'arrow-right'}
		<line x1="5" y1="12" x2="19" y2="12" />
		<polyline points="12 5 19 12 12 19" />
	{:else if name === 'arrow-left'}
		<line x1="19" y1="12" x2="5" y2="12" />
		<polyline points="12 19 5 12 12 5" />
	{:else if name === 'chevron-right'}
		<polyline points="9 18 15 12 9 6" />
	{:else if name === 'lock'}
		<rect x="3" y="11" width="18" height="11" rx="2" />
		<path d="M7 11V7a5 5 0 0 1 10 0v4" />
	{:else if name === 'check'}
		<polyline points="20 6 9 17 4 12" />
	{:else if name === 'plus'}
		<line x1="12" y1="5" x2="12" y2="19" />
		<line x1="5" y1="12" x2="19" y2="12" />
	{:else if name === 'log-out'}
		<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
		<polyline points="16 17 21 12 16 7" />
		<line x1="21" y1="12" x2="9" y2="12" />
	{:else if name === 'alert-circle'}
		<circle cx="12" cy="12" r="10" />
		<line x1="12" y1="8" x2="12" y2="12" />
		<line x1="12" y1="16" x2="12.01" y2="16" />
	{:else if name === 'alert-triangle'}
		<path
			d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
		/>
		<line x1="12" y1="9" x2="12" y2="13" />
		<line x1="12" y1="17" x2="12.01" y2="17" />
	{:else if name === 'pause'}
		<rect x="14" y="4" width="4" height="16" rx="1" />
		<rect x="6" y="4" width="4" height="16" rx="1" />
	{:else if name === 'play'}
		<polygon points="6 3 20 12 6 21 6 3" />
	{/if}
</svg>
