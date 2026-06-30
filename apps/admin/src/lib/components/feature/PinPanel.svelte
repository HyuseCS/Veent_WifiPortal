<script lang="ts">
	import { enhance } from '$app/forms';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { NetworkAp } from '$lib/types';
	import type { Pin } from '$lib/networkMap';
	import type { RouterModel } from '$lib/router-models';

	// The new/edit pin editor — one card per active pin. Extracted from NetworkMap.svelte;
	// the parent owns the pins state + Leaflet layers and passes the mutators in. Functions
	// are keyed by localId (called with `pin.localId`) so they stay stable parent refs.
	let {
		pin,
		models,
		allClusterNames,
		creatingCluster,
		geoMsg,
		nameOpen,
		setNameOpen,
		nameSuggestions,
		isNameReachable,
		saveEnhance,
		discardPin,
		setModel,
		setRange,
		setCluster,
		onClusterSelect,
		onNameInput,
		geocodePin,
		requestDelete
	}: {
		pin: Pin;
		models: RouterModel[];
		allClusterNames: string[];
		creatingCluster: Record<number, boolean>;
		geoMsg: Record<number, string>;
		nameOpen: number | null;
		setNameOpen: (v: number | null) => void;
		nameSuggestions: (pin: Pin) => NetworkAp[];
		isNameReachable: (pin: Pin, name: string) => boolean;
		saveEnhance: (localId: number) => SubmitFunction;
		discardPin: (localId: number) => void;
		setModel: (localId: number, model: string) => void;
		setRange: (localId: number, range: number) => void;
		setCluster: (localId: number, cluster: string | null) => void;
		onClusterSelect: (localId: number, value: string) => void;
		onNameInput: (localId: number, value: string) => void;
		geocodePin: (localId: number) => void;
		requestDelete: (pin: Pin) => void;
	} = $props();
</script>

<div class="rounded border border-border bg-surface p-2">
	<div class="flex items-center justify-between gap-2">
		<span class="text-xs font-medium text-ink">
			{pin.apId ? `Editing: ${pin.name || 'AP'}` : 'New router'}
		</span>
		<button
			onclick={() => discardPin(pin.localId)}
			class="flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-bg hover:text-blocked"
			aria-label={pin.apId ? 'Cancel edit' : 'Remove pin'}
		>
			<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
		</button>
	</div>

	<select
		value={pin.model}
		onchange={(e) => setModel(pin.localId, e.currentTarget.value)}
		class="mt-1.5 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
	>
		{#each models as m (m.id)}
			<option value={m.id}>{m.name} — {m.rangeMeters} m advertised</option>
		{/each}
	</select>

	<label class="mt-1.5 block text-xs text-muted">
		<span class="flex items-center justify-between">
			<span>Coverage radius</span>
			<span class="font-mono text-ink">{pin.range} m</span>
		</span>
		<input
			type="range"
			min="25"
			max="2000"
			step="25"
			value={pin.range}
			oninput={(e) => setRange(pin.localId, Number(e.currentTarget.value))}
			class="mt-1 w-full accent-brand"
			aria-label="Coverage radius in metres"
		/>
	</label>

	<label class="mt-1.5 block text-xs text-muted">
		<span>Cluster</span>
		<select
			value={creatingCluster[pin.localId] ? '__new__' : (pin.cluster ?? '')}
			onchange={(e) => onClusterSelect(pin.localId, e.currentTarget.value)}
			class="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
		>
			<option value="">None</option>
			{#each allClusterNames as name (name)}
				{@const reachable = isNameReachable(pin, name)}
				<option value={name} disabled={!reachable && name !== pin.cluster}>
					{name}{reachable ? '' : ' (out of reach)'}
				</option>
			{/each}
			<option value="__new__">+ New cluster…</option>
		</select>
	</label>
	{#if creatingCluster[pin.localId]}
		<input
			value={pin.cluster ?? ''}
			oninput={(e) => setCluster(pin.localId, e.currentTarget.value)}
			placeholder="New cluster name"
			class="mt-1.5 w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
		/>
	{/if}

	<form
		method="post"
		action={(pin.apId ?? pin.targetId) ? '?/updatePlace' : '?/addPlace'}
		use:enhance={saveEnhance(pin.localId)}
		class="mt-1.5 space-y-1.5"
	>
		{#if pin.apId ?? pin.targetId}
			<input type="hidden" name="id" value={pin.apId ?? pin.targetId} />
		{/if}
		<input type="hidden" name="latitude" value={pin.lat} />
		<input type="hidden" name="longitude" value={pin.lng} />
		<input type="hidden" name="model" value={pin.model} />
		<input type="hidden" name="range" value={pin.range} />
		<input type="hidden" name="cluster" value={pin.cluster ?? ''} />
		<!-- Name combobox: free text + an in-UI suggestion list of unplaced APs. Edit pins
		     (apId set) skip the suggestions — you don't rebind an already-placed AP. -->
		<div class="relative">
			<input
				name="name"
				value={pin.name}
				oninput={(e) => onNameInput(pin.localId, e.currentTarget.value)}
				onfocus={() => setNameOpen(pin.apId ? null : pin.localId)}
				onblur={() => setNameOpen(nameOpen === pin.localId ? null : nameOpen)}
				autocomplete="off"
				role="combobox"
				aria-expanded={nameOpen === pin.localId && nameSuggestions(pin).length > 0}
				aria-controls="name-opts-{pin.localId}"
				placeholder="Name this AP"
				class="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
			/>
			{#if nameOpen === pin.localId && nameSuggestions(pin).length > 0}
				<ul
					id="name-opts-{pin.localId}"
					role="listbox"
					class="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded border border-border bg-bg shadow-md"
				>
					{#each nameSuggestions(pin) as ap (ap.id)}
						<li role="option" aria-selected={pin.name === ap.name}>
							<button
								type="button"
								onpointerdown={(e) => e.preventDefault()}
								onclick={() => {
									onNameInput(pin.localId, ap.name);
									setNameOpen(null);
								}}
								class="block w-full truncate px-2 py-1.5 text-left text-xs text-ink hover:bg-surface"
							>
								{ap.name}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<div class="flex gap-1.5">
			<input
				name="address"
				bind:value={pin.address}
				placeholder="Address (optional)"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						geocodePin(pin.localId);
					}
				}}
				class="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1.5 text-xs text-ink"
			/>
			<button
				type="button"
				onclick={() => geocodePin(pin.localId)}
				disabled={!pin.address.trim()}
				class="flex w-8 shrink-0 items-center justify-center rounded border border-border text-brand hover:bg-bg disabled:opacity-50"
				aria-label="Move pin to this address"
			>
				<MapPin class="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		</div>
		{#if geoMsg[pin.localId]}
			<p class="text-xs {geoMsg[pin.localId] === 'Searching…' ? 'text-muted' : 'text-blocked'}">
				{geoMsg[pin.localId]}
			</p>
		{/if}
		<button
			type="submit"
			disabled={!pin.name.trim()}
			class="min-h-[36px] w-full rounded bg-brand px-2 text-xs font-medium text-white disabled:opacity-50"
		>
			{pin.apId ? 'Save changes' : 'Save to network'}
		</button>
	</form>

	{#if pin.apId}
		<button
			type="button"
			onclick={() => requestDelete(pin)}
			class="mt-1.5 min-h-[36px] w-full rounded border border-blocked px-2 text-xs font-medium text-blocked hover:bg-blocked/10"
		>
			Remove AP
		</button>
	{/if}
</div>
