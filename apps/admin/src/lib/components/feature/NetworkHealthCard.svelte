<script lang="ts">
	import { enhance } from '$app/forms';
	import type { NetworkAp } from '$lib/types';
	import { Button, Card, Field, StatusBadge } from '$lib/components/ui';

	let { ap }: { ap: NetworkAp } = $props();

	// Metric rows rendered from data so the markup stays a single <dl> loop.
	const metrics = $derived([
		{ label: 'Uptime', value: ap.uptime },
		{ label: 'Latency', value: ap.latency },
		{ label: 'Users', value: String(ap.users) },
		{ label: 'Tput', value: ap.throughput }
	]);

	const placed = $derived(ap.latitude != null && ap.longitude != null);

	let saving = $state(false);
	let msg = $state<{ ok: boolean; text: string } | null>(null);
</script>

<Card padding="p-4">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-sm font-semibold text-ink">{ap.name}</h3>
		<StatusBadge tone={ap.tone} label={ap.status} />
	</div>
	<dl class="mt-4 grid grid-cols-4 divide-x divide-border text-center">
		{#each metrics as metric (metric.label)}
			<div class="px-2">
				<dt class="text-xs text-muted">{metric.label}</dt>
				<dd class="mt-0.5 font-mono text-sm font-semibold text-ink">{metric.value}</dd>
			</div>
		{/each}
	</dl>

	<details class="mt-4 border-t border-border pt-3">
		<summary
			class="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-ink"
		>
			<span
				class="inline-block h-2 w-2 rounded-full"
				style="background: {placed ? 'var(--color-online)' : 'var(--color-border)'}"
			></span>
			Map location
			<span class="text-xs font-normal text-muted">{placed ? 'on map' : 'not placed'}</span>
		</summary>

		<form
			method="POST"
			action="?/setLocation"
			class="mt-3 space-y-3"
			use:enhance={() => {
				saving = true;
				msg = null;
				return async ({ result, update }) => {
					saving = false;
					if (result.type === 'success') {
						msg = { ok: true, text: 'Saved.' };
					} else if (result.type === 'failure') {
						msg = { ok: false, text: String(result.data?.error ?? 'Could not save.') };
					}
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="id" value={ap.id} />
			<div class="grid grid-cols-2 gap-3">
				<Field
					id="lat-{ap.id}"
					name="latitude"
					label="Latitude"
					type="text"
					inputmode="decimal"
					placeholder="14.5560"
					value={ap.latitude ?? ''}
				/>
				<Field
					id="lng-{ap.id}"
					name="longitude"
					label="Longitude"
					type="text"
					inputmode="decimal"
					placeholder="121.0244"
					value={ap.longitude ?? ''}
				/>
			</div>
			<Field
				id="addr-{ap.id}"
				name="address"
				label="Address"
				type="text"
				placeholder="Venue, City"
				value={ap.address ?? ''}
			/>
			<div class="flex items-center gap-3">
				<Button type="submit" loading={saving}>Save location</Button>
				{#if msg}
					<span
						class="text-xs"
						style="color: {msg.ok ? 'var(--color-online)' : 'var(--color-blocked)'}"
					>
						{msg.text}
					</span>
				{/if}
			</div>
		</form>
	</details>
</Card>
