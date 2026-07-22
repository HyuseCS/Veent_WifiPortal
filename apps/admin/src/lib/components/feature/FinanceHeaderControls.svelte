<script lang="ts">
	import Download from 'lucide-svelte/icons/download';
	import Receipt from 'lucide-svelte/icons/receipt';
	import ChartColumn from 'lucide-svelte/icons/chart-column';
	import SlidersHorizontal from 'lucide-svelte/icons/sliders-horizontal';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Check from 'lucide-svelte/icons/check';
	import { page } from '$app/state';

	// Finance page-wide controls, lifted into the Topbar header. Shown on both the overview
	// (/finance) and the transactions list (/finance/transactions). Period + Export are fully
	// derivable from the URL (`?period=`), so this owns no page data. The time-range + export
	// sit in a dropdown to keep the header uncluttered; only the page-nav button stays inline.
	const periodTabs = [
		{ key: '7d', label: '7 days' },
		{ key: '30d', label: '30 days' },
		{ key: '90d', label: '90 days' },
		{ key: 'all', label: 'All time' }
	];
	const periodLabel: Record<string, string> = {
		'7d': '7 days',
		'30d': '30 days',
		'90d': '90 days',
		all: 'All time'
	};
	// ponytail: mirror server parsePeriod's normalisation (default/fallback = 30d); kept inline
	// because parsePeriod lives in $lib/server and can't be imported into client code.
	const raw = $derived(page.url.searchParams.get('period'));
	const period = $derived(raw === '7d' || raw === '90d' || raw === 'all' ? raw : '30d');

	// Pills keep you on the current finance page; the nav button toggles between the two.
	const onList = $derived(page.url.pathname === '/finance/transactions');
	const btn =
		'inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink transition-colors hover:bg-surface';

	let open = $state(false);
	let menuEl = $state<HTMLElement>();
	// Close the dropdown on an outside click or Escape (only while open).
	$effect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent) => {
			if (menuEl && !menuEl.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		document.addEventListener('click', onClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="flex items-center gap-3">
	{#if onList}
		<a
			href="/finance?period={period}"
			class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0"
			aria-label="Overview"
		>
			<ChartColumn class="h-4 w-4" aria-hidden="true" />
			<span class="hidden sm:inline">Overview</span>
		</a>
	{:else}
		<a
			href="/finance/transactions?period={period}"
			class="{btn} max-sm:w-11 max-sm:justify-center max-sm:px-0"
			aria-label="Transactions"
		>
			<Receipt class="h-4 w-4" aria-hidden="true" />
			<span class="hidden sm:inline">Transactions</span>
		</a>
	{/if}

	<div class="relative" bind:this={menuEl}>
		<button
			type="button"
			class="{btn} max-sm:px-2.5"
			aria-haspopup="menu"
			aria-expanded={open}
			aria-label="Time range: {periodLabel[period]}"
			onclick={() => (open = !open)}
		>
			<SlidersHorizontal class="h-4 w-4" aria-hidden="true" />
			<span class="hidden sm:inline">{periodLabel[period]}</span>
			<ChevronDown
				class="h-4 w-4 transition-transform duration-150 {open ? 'rotate-180' : ''}"
				aria-hidden="true"
			/>
		</button>

		{#if open}
			<div
				role="menu"
				class="absolute right-0 z-30 mt-2 w-48 rounded-lg border border-border bg-bg p-1 shadow-lg"
			>
				<p class="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
					Time range
				</p>
				{#each periodTabs as t (t.key)}
					<a
						role="menuitem"
						href="{page.url.pathname}?period={t.key}"
						onclick={() => (open = false)}
						class="flex min-h-11 items-center justify-between rounded-md px-3 text-sm hover:bg-surface {t.key ===
						period
							? 'font-semibold text-brand'
							: 'text-ink'}"
					>
						{t.label}
						{#if t.key === period}<Check class="h-4 w-4" aria-hidden="true" />{/if}
					</a>
				{/each}

				<div class="my-1 h-px bg-border" aria-hidden="true"></div>

				<p class="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
					Export CSV
				</p>
				<a
					role="menuitem"
					href="/finance/export?period={period}&scope=maya"
					download
					onclick={() => (open = false)}
					class="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-ink hover:bg-surface"
				>
					<Download class="h-4 w-4" aria-hidden="true" />
					Maya payments
				</a>
				<a
					role="menuitem"
					href="/finance/export?period={period}&scope=unified"
					download
					onclick={() => (open = false)}
					class="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-ink hover:bg-surface"
				>
					<Download class="h-4 w-4" aria-hidden="true" />
					All activity
				</a>
			</div>
		{/if}
	</div>
</div>
