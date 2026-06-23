<script lang="ts">
	import { CoverageMap } from '$lib/components/feature';
	import AddPlaceDialog from '$lib/components/feature/AddPlaceDialog.svelte';
	import { SearchInput } from '$lib/components/ui';
	import List from 'lucide-svelte/icons/list';
	import Plus from 'lucide-svelte/icons/plus';
	import X from 'lucide-svelte/icons/x';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const networks = $derived(data.networks);
	const total = $derived(networks.length);
	const placedCount = $derived(
		networks.filter((n) => n.latitude != null && n.longitude != null).length
	);
	const placedPct = $derived(total > 0 ? Math.round((placedCount / total) * 100) : 0);

	let panelOpen = $state(true);
	let addOpen = $state(false);
	let query = $state('');
	let selectedId = $state<string | null>(null);

	const filtered = $derived(
		networks.filter((ap) => {
			const q = query.trim().toLowerCase();
			if (!q) return true;
			return ap.name.toLowerCase().includes(q) || (ap.address ?? '').toLowerCase().includes(q);
		})
	);

	const toneDot: Record<string, string> = {
		online: 'bg-online',
		warning: 'bg-warning',
		blocked: 'bg-blocked'
	};

	function focusAp(id: string) {
		selectedId = id;
	}
</script>

<!-- Negate main's padding so the map fills edge-to-edge. Topbar is h-16 (4rem). -->
<div class="-m-6 flex h-[calc(100vh-4rem)] overflow-hidden">
	<!-- AP Panel (side column) -->
		{#if panelOpen}
			<aside class="flex w-85 shrink-0 flex-col border-r border-border bg-bg">
				<!-- Panel header -->
				<div class="flex items-center justify-between px-5 pb-4 pt-5">
					<div class="flex items-center gap-2.5">
						<h2 class="text-base font-semibold text-ink">Access Points</h2>
						<span class="rounded-md bg-brand/10 px-2 py-0.5 font-mono text-xs font-bold text-brand">
							{total}
						</span>
					</div>
					<button
						onclick={() => (panelOpen = false)}
						class="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-ink/20 hover:text-ink"
						aria-label="Close panel"
					>
						<X class="h-4 w-4" aria-hidden="true" />
					</button>
				</div>

				<!-- Search -->
				<div class="px-5 pb-4">
					<SearchInput
						bind:value={query}
						placeholder="Search APs…"
						label="Search access points"
						class="w-full"
					/>
				</div>

				<!-- AP list -->
				<div class="flex-1 overflow-y-auto">
					{#if filtered.length === 0}
						<p class="px-5 py-8 text-center text-sm text-muted">
							{query.trim() ? `No APs match "${query}".` : 'No access points yet.'}
						</p>
					{:else}
						{#each filtered as ap (ap.id)}
							{@const isSelected = ap.id === selectedId}
							{@const isPlaced = ap.latitude != null && ap.longitude != null}
							<button
								onclick={() => focusAp(ap.id)}
								class="flex min-h-11 w-full items-center gap-3 border-l-[3px] px-5 py-3 text-left transition-colors hover:bg-surface {isSelected
									? 'border-brand bg-brand/5'
									: 'border-transparent'}"
							>
								<span class="h-2.5 w-2.5 shrink-0 rounded-full {toneDot[ap.tone] ?? 'bg-muted'}">
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-bold text-ink">{ap.name}</span>
									{#if ap.address}
										<span class="block truncate text-xs text-muted">{ap.address}</span>
									{/if}
								</span>
								{#if !isPlaced}
									<span
										class="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning"
									>
										UNPLACED
									</span>
								{/if}
							</button>
						{/each}
					{/if}
				</div>

				<!-- Panel footer -->
				<div class="space-y-3 border-t border-border px-5 py-4">
					<button
						onclick={() => (addOpen = true)}
						class="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand/50 bg-brand/5 text-sm font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
					>
						<Plus class="h-4 w-4" aria-hidden="true" />
						Add router location
					</button>
					<div class="flex items-center gap-3">
						<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
							<div
								class="h-full rounded-full bg-online transition-[width] duration-300"
								style="width: {placedPct}%"
							></div>
						</div>
						<span class="shrink-0 text-xs font-medium text-muted">
							{placedCount} of {total} AP{total === 1 ? '' : 's'} placed
						</span>
					</div>
				</div>
			</aside>
		{/if}

		<!-- Map with status legend overlay -->
		<div class="relative min-w-0 flex-1">
			<div class="absolute inset-0">
				<CoverageMap {networks} {selectedId} onselect={focusAp} />
			</div>

			<!-- "Access Points" toggle (shown when panel is closed) -->
			{#if !panelOpen}
				<button
					onclick={() => (panelOpen = true)}
					class="absolute top-4 left-4 z-10 flex h-9 items-center gap-2 rounded-lg border border-border bg-bg/90 px-3 text-sm font-semibold text-ink shadow-sm backdrop-blur-sm transition-colors hover:border-brand/40 hover:text-brand"
				>
					<List class="h-4 w-4" aria-hidden="true" />
					Access Points
				</button>
			{/if}

			<!-- Status legend (top-right) -->
			<div
				class="absolute top-4 right-4 z-10 flex gap-3.5 rounded-xl border border-border bg-bg/90 px-3.5 py-2 shadow-sm backdrop-blur-sm"
			>
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted">
					<span class="h-2 w-2 rounded-full bg-online"></span>Healthy
				</span>
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted">
					<span class="h-2 w-2 rounded-full bg-warning"></span>Degraded
				</span>
				<span class="flex items-center gap-1.5 text-xs font-semibold text-muted">
					<span class="h-2 w-2 rounded-full bg-blocked"></span>Offline
				</span>
			</div>
		</div>
</div>

<AddPlaceDialog bind:open={addOpen} />
