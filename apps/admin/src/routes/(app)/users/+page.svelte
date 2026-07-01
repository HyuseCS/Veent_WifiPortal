<script lang="ts">
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Users from 'lucide-svelte/icons/users';
	import Wifi from 'lucide-svelte/icons/wifi';
	import Wallet from 'lucide-svelte/icons/wallet';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Ban from 'lucide-svelte/icons/ban';
	import type { Component } from 'svelte';
	import { UsersTable, KpiCard, KpiCarousel, WipeDialog } from '$lib/components/feature';
	import { Button } from '$lib/components/ui';
	import type { StatusTone } from '$lib/types';
	import { live, connectLive } from '$lib/live.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Realtime: read the shared live snapshot (the same /api/connected stream the Topbar
	// already opens) so online status, balances, and block state update without a reload —
	// falling back to the SSR-loaded list until the first frame (business rule #5).
	$effect(connectLive);
	const users = $derived(live.snapshot?.users ?? data.users);

	// lucide types don't match Svelte's `Component` structurally; cast as the other pages do.
	const icon = (c: unknown) => c as Component;

	// KPI strip — every value derives from the loaded user list (no extra data source). Uses
	// the shared <KpiCard> so the metrics match Dashboard/Networks/Finance exactly.
	const onlineCount = $derived(users.filter((u) => u.online).length);
	const lowCount = $derived(users.filter((u) => u.tone === 'warning').length);
	const blockedCount = $derived(users.filter((u) => u.tone === 'blocked').length);
	const creditTotal = $derived(users.reduce((sum, u) => sum + u.balance, 0));

	type UserKpi = {
		label: string;
		value: string;
		icon: Component;
		helper: string;
		tone?: StatusTone;
		captionTone?: StatusTone;
	};
	const kpis = $derived<UserKpi[]>([
		{ label: 'Registered', value: String(users.length), icon: icon(Users), helper: 'total guests' },
		{
			label: 'Online Now',
			value: String(onlineCount),
			icon: icon(Wifi),
			helper: 'connected',
			tone: 'online',
			captionTone: 'online'
		},
		{
			label: 'Credit Balance',
			value: `₱${creditTotal.toLocaleString('en-PH')}`,
			icon: icon(Wallet),
			helper: 'held by guests'
		},
		{
			label: 'Low Balance',
			value: String(lowCount),
			icon: icon(TriangleAlert),
			helper: 'under ₱10',
			tone: 'warning',
			captionTone: 'warning'
		},
		{
			label: 'Blocked',
			value: String(blockedCount),
			icon: icon(Ban),
			helper: 'denied access',
			tone: 'blocked',
			captionTone: 'blocked'
		}
	]);

	// Owner-only, step-up-verified wipe of the whole customer base. The two-step flow lives
	// in the shared <WipeDialog>; nothing is destructive until the emailed code is accepted.
	let wipeOpen = $state(false);
</script>

<!-- Full-height flex column so the table body scrolls, not the page (see UsersTable's Table).
     h-full (not md:h-full) so the body-scrolls-not-page behaviour also holds on mobile. -->
<div class="flex flex-col gap-5 h-full">
	<KpiCarousel items={kpis} class="shrink-0">
		{#snippet card(k)}
			<KpiCard
				kpi={{ label: k.label, value: k.value }}
				icon={k.icon}
				helper={k.helper}
				tone={k.tone}
				captionTone={k.captionTone}
				compact
			/>
		{/snippet}
	</KpiCarousel>

	<UsersTable {users} isOwner={data.isOwner}>
		{#snippet actions()}
			{#if data.isOwner}
				<!-- Icon-only below sm so the toolbar stays one line on mobile; full label at sm+. -->
				<Button
					variant="danger"
					onclick={() => (wipeOpen = true)}
					title="Wipe database"
					aria-label="Wipe database"
					class="shrink-0 max-sm:w-11 max-sm:px-0"
				>
					<Trash2 class="h-4 w-4" aria-hidden="true" />
					<span class="hidden sm:inline">Wipe database</span>
				</Button>
			{/if}
		{/snippet}
	</UsersTable>
</div>

{#if data.isOwner}
	<WipeDialog
		bind:open={wipeOpen}
		title="Wipe user database"
		count={users.length}
		noun="customers"
		detail="their sessions, credit history, and logins"
		{form}
	/>
{/if}
