<script lang="ts">
	import Mail from 'lucide-svelte/icons/mail';
	import UserCheck from 'lucide-svelte/icons/user-check';
	import UserX from 'lucide-svelte/icons/user-x';
	import Users from 'lucide-svelte/icons/users';
	import type { Component } from 'svelte';
	import { AddStaffForm, KpiCard, StaffTable } from '$lib/components/feature';
	import type { StatusTone } from '$lib/types';
	import type { PageData } from './$types';

	// Owner-only page (the route guards access server-side). Staff and all mutations
	// are DB-backed: AddStaffForm posts to ?/invite, StaffTable to ?/setStatus & ?/remove.
	let { data }: { data: PageData } = $props();
	const staff = $derived(data.staff);

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

<div class="space-y-5">
	<section class="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

	<AddStaffForm />

	<StaffTable {staff} />
</div>
