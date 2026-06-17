<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A header cell definition. `srOnly` hides the label visually (e.g. an actions column). */
	interface Column {
		label: string;
		srOnly?: boolean;
	}

	// Bordered table shell: renders the styled header from `columns`; rows go in the default slot.
	let { columns, children }: { columns: Column[]; children: Snippet } = $props();
</script>

<div class="overflow-hidden rounded-lg border border-border bg-bg">
	<table class="w-full text-sm">
		<thead>
			<tr class="border-b border-border bg-surface">
				{#each columns as col (col.label)}
					<th
						class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase"
					>
						{#if col.srOnly}<span class="sr-only">{col.label}</span>{:else}{col.label}{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody class="divide-y divide-border">
			{@render children()}
		</tbody>
	</table>
</div>
