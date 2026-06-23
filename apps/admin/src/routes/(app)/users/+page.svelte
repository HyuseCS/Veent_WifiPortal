<script lang="ts">
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Users from 'lucide-svelte/icons/users';
	import Wifi from 'lucide-svelte/icons/wifi';
	import Wallet from 'lucide-svelte/icons/wallet';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import Ban from 'lucide-svelte/icons/ban';
	import type { Component } from 'svelte';
	import { enhance } from '$app/forms';
	import { UsersTable, KpiCard } from '$lib/components/feature';
	import { Button, Field } from '$lib/components/ui';
	import type { StatusTone } from '$lib/types';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const users = $derived(data.users);

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

	// Wiping the whole customer base is owner-only and step-up verified: the owner
	// requests a one-time code (emailed to them), then enters it to confirm. The
	// native <dialog> drives the two steps; nothing is destructive until the code
	// is accepted server-side.
	let wipeDialog = $state<HTMLDialogElement>();
	let step = $state<'request' | 'confirm'>('request');
	let code = $state('');

	function openWipe() {
		step = 'request';
		code = '';
		wipeDialog?.showModal();
	}
</script>

<div class="space-y-5">
	<section class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
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

	<UsersTable {users}>
		{#snippet actions()}
			{#if data.isOwner}
				<Button variant="secondary" class="text-blocked hover:bg-blocked/10" onclick={openWipe}>
					<Trash2 class="h-4 w-4" aria-hidden="true" />
					Wipe database
				</Button>
			{/if}
		{/snippet}
	</UsersTable>
</div>

{#if data.isOwner}
	<dialog
		bind:this={wipeDialog}
		onclose={() => {
			step = 'request';
			code = '';
		}}
		class="m-auto w-full max-w-sm rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
	>
		<h2 class="text-lg font-semibold text-blocked">Wipe user database</h2>
		<p class="mt-2 text-sm text-muted">
			This permanently deletes <strong>all {users.length} customers</strong> and their sessions, credit
			history, and logins. This cannot be undone.
		</p>

		{#if step === 'request'}
			<!-- Step 1: email the owner a one-time confirmation code. -->
			<form
				method="post"
				action="?/requestWipeCode"
				use:enhance={() =>
					({ update, result }) => {
						if (result.type === 'success') step = 'confirm';
						return update({ reset: false });
					}}
				class="mt-4 space-y-3"
			>
				<p class="text-sm text-muted">
					We'll email a verification code to your admin address. Enter it on the next step to
					confirm.
				</p>
				{#if form?.error}<p class="text-sm text-blocked">{form.error}</p>{/if}
				<div class="flex justify-end gap-2">
					<Button type="button" variant="secondary" onclick={() => wipeDialog?.close()}
						>Cancel</Button
					>
					<Button type="submit">Email me a code</Button>
				</div>
			</form>
		{:else}
			<!-- Step 2: enter the emailed code to execute the wipe. -->
			<form
				method="post"
				action="?/wipe"
				use:enhance={() =>
					({ update, result }) => {
						if (result.type === 'success') wipeDialog?.close();
						return update({ reset: false });
					}}
				class="mt-4 space-y-3"
			>
				<p class="text-sm text-online">Code sent — check your email.</p>
				<Field
					id="wipe-code"
					label="Verification code"
					name="code"
					inputmode="numeric"
					autocomplete="one-time-code"
					value={code}
					oninput={(e) => (code = e.currentTarget.value)}
					class="font-mono tracking-widest"
				/>
				{#if form?.error}<p class="text-sm text-blocked">{form.error}</p>{/if}
				<div class="flex justify-end gap-2">
					<Button type="button" variant="secondary" onclick={() => wipeDialog?.close()}
						>Cancel</Button
					>
					<Button
						type="submit"
						class="bg-blocked text-white hover:bg-blocked/90"
						disabled={!code.trim()}
					>
						Wipe everything
					</Button>
				</div>
			</form>
		{/if}
	</dialog>
{/if}
