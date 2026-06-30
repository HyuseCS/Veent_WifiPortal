<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { Card, Button, Field } from '$lib/components/ui';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Per-save MFA: a valid authenticator code is required to save (server re-checks it).
	let code = $state('');
	const codeValid = $derived(/^\d{6}$/.test(code));

	// Seed the form once from the saved limits; edits stay local until saved. `untrack`
	// makes the one-time read of `data` explicit so it isn't treated as a live dependency.
	const seed = untrack(() => data.limits);
	let maxDevicesPerAccount = $state(String(seed.maxDevicesPerAccount));
	let freeTimeMinutes = $state(String(seed.freeTimeMinutes));
	let freeTimeCooldownHours = $state(String(seed.freeTimeCooldownHours));

	const fields = [
		{
			name: 'maxDevicesPerAccount',
			label: 'Devices per account',
			hint: 'How many devices one account can have online at once. Connecting beyond this replaces the least-recently-used device.',
			suffix: 'devices',
			get: () => maxDevicesPerAccount,
			set: (v: string) => (maxDevicesPerAccount = v)
		},
		{
			name: 'freeTimeMinutes',
			label: 'Free-time length',
			hint: 'Minutes granted each time a guest claims Free Time.',
			suffix: 'minutes',
			get: () => freeTimeMinutes,
			set: (v: string) => (freeTimeMinutes = v)
		},
		{
			name: 'freeTimeCooldownHours',
			label: 'Free-time cooldown',
			hint: 'How long an account must wait between Free-Time claims.',
			suffix: 'hours',
			get: () => freeTimeCooldownHours,
			set: (v: string) => (freeTimeCooldownHours = v)
		}
	];
</script>

<div class="space-y-5">
	<div>
		<h2 class="text-base font-semibold text-ink">Session Limits</h2>
		<p class="mt-0.5 text-xs text-muted">
			Account-wide rules for devices and Free Time. Changes apply within ~30 seconds across the
			portal — no deploy needed.
		</p>
	</div>

	{#if form?.error}
		<p class="rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{form.error}</p>
	{:else if form?.ok}
		<p class="rounded-lg bg-online/10 px-4 py-3 text-sm text-online" role="status">
			Saved. New limits are live.
		</p>
	{/if}

	<Card class="max-w-xl">
		<form method="post" action="?/save" use:enhance class="flex flex-col gap-5">
			{#each fields as f (f.name)}
				<label class="flex flex-col gap-1.5">
					<span class="text-sm font-medium text-ink">{f.label}</span>
					<span class="text-xs text-muted">{f.hint}</span>
					<span class="mt-1 flex items-center gap-2">
						<input
							name={f.name}
							type="number"
							step="1"
							min="0"
							value={f.get()}
							oninput={(e) => f.set((e.currentTarget as HTMLInputElement).value)}
							class="min-h-[44px] w-28 rounded-lg border border-border bg-bg px-3 font-mono text-sm text-ink"
						/>
						<span class="text-xs text-muted">{f.suffix}</span>
					</span>
				</label>
			{/each}

			<Field
				id="limits-code"
				name="code"
				label="Authenticator code"
				inputmode="numeric"
				autocomplete="one-time-code"
				placeholder="6-digit code"
				value={code}
				oninput={(e) => (code = e.currentTarget.value)}
				class="max-w-40 font-mono tracking-widest"
			/>

			<div>
				<Button type="submit" disabled={!codeValid}>Save limits</Button>
			</div>
		</form>
	</Card>
</div>
