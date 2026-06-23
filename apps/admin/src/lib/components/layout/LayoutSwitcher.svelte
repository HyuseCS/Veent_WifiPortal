<script lang="ts">
	import { getContext, type Component } from 'svelte';
	import { fade } from 'svelte/transition';
	import LayoutGrid from 'lucide-svelte/icons/layout-grid';
	import Columns2 from 'lucide-svelte/icons/columns-2';
	import Rows3 from 'lucide-svelte/icons/rows-3';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import { DASH_LAYOUT_CTX, type DashLayout, type DashLayoutCtx } from '$lib/dashboard-layout';

	// Header control that switches the dashboard arrangement. State lives in the (app)
	// layout (shared with the dashboard grid) and is reached through context.
	const ctx = getContext<DashLayoutCtx>(DASH_LAYOUT_CTX);

	// lucide-svelte icon types don't structurally match Svelte's `Component`; cast as nav.ts does.
	const icon = (c: unknown) => c as Component;
	const options: { value: DashLayout; label: string; icon: Component }[] = [
		{ value: 'bento', label: 'Bento', icon: icon(LayoutGrid) },
		{ value: 'split', label: 'Two columns', icon: icon(Columns2) },
		{ value: 'stacked', label: 'Stacked', icon: icon(Rows3) }
	];

	let open = $state(false);
	const currentOption = $derived(options.find((o) => o.value === ctx.current) ?? options[0]);
	const TriggerIcon = $derived(currentOption.icon);

	function choose(value: DashLayout) {
		ctx.choose(value);
		open = false;
	}
</script>

<div class="relative">
	<button
		type="button"
		onclick={() => (open = !open)}
		aria-haspopup="menu"
		aria-expanded={open}
		class="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm font-medium text-ink outline-none transition-[background-color,color,transform,border-color] duration-150 hover:border-brand/40 hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand/40 active:scale-95"
	>
		<TriggerIcon class="h-4 w-4 text-muted" aria-hidden="true" />
		<span class="hidden sm:inline">{currentOption.label}</span>
		<ChevronDown class="h-4 w-4 text-muted" aria-hidden="true" />
	</button>
	{#if open}
		<!-- Light-dismiss backdrop: a click anywhere else closes the menu. -->
		<button
			type="button"
			class="fixed inset-0 z-40 cursor-default"
			aria-label="Close layout menu"
			onclick={() => (open = false)}
		></button>
		<div
			class="absolute top-full right-0 z-50 mt-1 w-44 origin-top-right overflow-hidden rounded-lg border border-border bg-bg py-1 shadow-lg"
			role="menu"
			transition:fade={{ duration: 120 }}
		>
			{#each options as opt (opt.value)}
				{@const Icon = opt.icon}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={ctx.current === opt.value}
					class="flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 hover:bg-surface focus-visible:bg-surface"
					onclick={() => choose(opt.value)}
				>
					<Icon class="h-4 w-4 text-muted" aria-hidden="true" />
					<span class="flex-1 text-left">{opt.label}</span>
					{#if ctx.current === opt.value}
						<Check class="h-4 w-4 text-brand" aria-hidden="true" />
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
