<script lang="ts">
	import Crown from 'lucide-svelte/icons/crown';
	import type { StaffRole } from '$lib/types';

	// Role chip shared by the staff table row and the profile modal header, so the
	// owner-crown treatment is defined once. Owner = brand-tinted chip with a crown;
	// every other role = a neutral surface chip. `label` is the DB-driven display name.
	let { role, label }: { role: StaffRole; label: string } = $props();
</script>

{#if role === 'owner'}
	<span
		class="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand"
	>
		<Crown class="h-3.5 w-3.5" aria-hidden="true" />
		{label}
	</span>
{:else}
	<span
		class="inline-flex items-center rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink"
	>
		{label}
	</span>
{/if}
