<script lang="ts">
	// Profile avatar: shows the uploaded image when present, else initials on a chip.
	// Sizing lives on `class` (e.g. "h-9 w-9 text-xs") so callers control dimensions; the
	// initials chip keeps the same bg-cta look used across the sidebar/tables.
	let {
		src = null,
		name = null,
		email = null,
		class: klass = '',
		alt
	}: {
		src?: string | null;
		name?: string | null;
		email?: string | null;
		class?: string;
		alt?: string;
	} = $props();

	const initials = $derived(
		(name ?? email ?? '?')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('')
	);
</script>

{#if src}
	<img {src} alt={alt ?? `${name ?? 'Profile'} avatar`} class="shrink-0 rounded-full object-cover {klass}" />
{:else}
	<div
		class="flex shrink-0 items-center justify-center rounded-full bg-cta font-semibold text-white {klass}"
		aria-hidden="true"
	>
		{initials}
	</div>
{/if}
