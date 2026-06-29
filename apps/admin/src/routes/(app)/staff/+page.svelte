<script lang="ts">
	import Mail from 'lucide-svelte/icons/mail';
	import UserCheck from 'lucide-svelte/icons/user-check';
	import UserX from 'lucide-svelte/icons/user-x';
	import Users from 'lucide-svelte/icons/users';
	import type { Component } from 'svelte';
	import { AddStaffForm, KpiCard, OwnerChangePanel, StaffTable } from '$lib/components/feature';
	import type { StatusTone } from '$lib/types';
	import type { ActionData, PageData } from './$types';

	// Owner-only page (the route guards access server-side). Staff and all mutations
	// are DB-backed: AddStaffForm posts to ?/invite, StaffTable to ?/setStatus & ?/remove.
	let { data, form }: { data: PageData; form: ActionData } = $props();
	const staff = $derived(data.staff);

	// The invite form is a modal, opened from the "Add staff" button in the table toolbar.
	let inviteOpen = $state(false);

	// lucide types don't match Svelte's `Component` structurally; cast as the other pages do.
	const icon = (c: unknown) => c as Component;

	// KPI strip — every value derives from the loaded staff list (no extra data source).
	// Uses the shared <KpiCard> so the metrics match Dashboard/Networks/Users/Finance.
	const activeCount = $derived(staff.filter((m) => m.status === 'active').length);
	const pendingCount = $derived(staff.filter((m) => m.status === 'pending').length);
	const disabledCount = $derived(staff.filter((m) => m.status === 'disabled').length);

	type StaffKpi = {
		label: string;
		value: string;
		icon: Component;
		helper: string;
		tone?: StatusTone;
		captionTone?: StatusTone;
	};
	const kpis = $derived<StaffKpi[]>([
		{
			label: 'Total staff',
			value: String(staff.length),
			icon: icon(Users),
			helper: 'Admins & owners'
		},
		{
			label: 'Active',
			value: String(activeCount),
			icon: icon(UserCheck),
			helper: 'Can sign in now',
			tone: 'online',
			captionTone: 'online'
		},
		{
			label: 'Invitations sent',
			value: String(pendingCount),
			icon: icon(Mail),
			helper: 'Awaiting activation',
			tone: 'warning',
			captionTone: 'warning'
		},
		{
			label: 'Disabled',
			value: String(disabledCount),
			icon: icon(UserX),
			helper: 'Access revoked',
			tone: 'blocked',
			captionTone: 'blocked'
		}
	]);
</script>

<!-- Full-height flex column so the members table scrolls internally, not the page (see
     StaffTable's Table). KPIs + invite form stay fixed; the table takes the rest. -->
<div class="flex flex-col gap-5 md:h-full">
	<section class="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each kpis as k (k.label)}
			<KpiCard
				kpi={{ label: k.label, value: k.value }}
				icon={k.icon}
				helper={k.helper}
				tone={k.tone}
				captionTone={k.captionTone}
			/>
		{/each}
	</section>

	<OwnerChangePanel
		requests={data.ownerChanges}
		currentUserId={data.currentUserId}
		{form}
	/>

	<StaffTable {staff} {form} currentUserId={data.currentUserId} onadd={() => (inviteOpen = true)} />
</div>

<AddStaffForm bind:open={inviteOpen} />
