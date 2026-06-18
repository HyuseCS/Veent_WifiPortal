<script lang="ts">
	/**
	 * Tiny inline-SVG icon set (Lucide geometry), mirroring the customer portal's
	 * dependency-free Icon so the locator pulls no icon package into its bundle.
	 * `stroke="currentColor"` means colour follows the `text-*` utility on the element.
	 */
	type IconName = 'search' | 'x' | 'menu' | 'map-pin';

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
	{#if name === 'search'}
		<circle cx="11" cy="11" r="8" />
		<line x1="21" y1="21" x2="16.65" y2="16.65" />
	{:else if name === 'x'}
		<line x1="18" y1="6" x2="6" y2="18" />
		<line x1="6" y1="6" x2="18" y2="18" />
	{:else if name === 'menu'}
		<line x1="4" y1="6" x2="20" y2="6" />
		<line x1="4" y1="12" x2="20" y2="12" />
		<line x1="4" y1="18" x2="20" y2="18" />
	{:else if name === 'map-pin'}
		<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
		<circle cx="12" cy="10" r="3" />
	{/if}
</svg>
