<script lang="ts">
	import { AddStaffForm, StaffTable } from '$lib/components/feature';
	import type { PageData } from './$types';

	// Owner-only page (the route guards access server-side). Staff and all mutations
	// are DB-backed: AddStaffForm posts to ?/invite, StaffTable to ?/setStatus & ?/remove.
	let { data }: { data: PageData } = $props();
	const staff = $derived(data.staff);
</script>

<div class="space-y-6">
	<p class="text-sm text-muted">{staff.length} staff members.</p>

	<AddStaffForm />

	<StaffTable {staff} />
</div>
