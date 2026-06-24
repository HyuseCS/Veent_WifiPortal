<script lang="ts">
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronsUpDown from 'lucide-svelte/icons/chevrons-up-down';

	// A clickable, sortable `<th>` — the shared version of the inline header button that
	// UsersTable/StaffTable each grew their own copy of. `active` marks this as the current
	// sort column (shows the direction arrow + aria-sort); otherwise a faint hover hint shows.
	let {
		label,
		active = false,
		dir = 'asc',
		align = 'left',
		onsort
	}: {
		label: string;
		active?: boolean;
		dir?: 'asc' | 'desc';
		align?: 'left' | 'right';
		onsort: () => void;
	} = $props();
</script>

<th
	class="px-4 py-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase {align ===
	'right'
		? 'text-right'
		: 'text-left'}"
	aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
>
	<button
		type="button"
		onclick={onsort}
		class="group inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-ink {active
			? 'text-ink'
			: ''}"
	>
		{label}
		{#if active}
			{#if dir === 'asc'}
				<ChevronUp class="h-3.5 w-3.5" aria-hidden="true" />
			{:else}
				<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
			{/if}
		{:else}
			<ChevronsUpDown
				class="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-50"
				aria-hidden="true"
			/>
		{/if}
	</button>
</th>
