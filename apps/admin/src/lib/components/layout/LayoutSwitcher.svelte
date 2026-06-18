<script lang="ts">
	import { getContext, type Component } from 'svelte';
	import { fade } from 'svelte/transition';
	import LayoutTemplate from 'lucide-svelte/icons/layout-template';
	import LayoutGrid from 'lucide-svelte/icons/layout-grid';
	import Columns2 from 'lucide-svelte/icons/columns-2';
	import Rows3 from 'lucide-svelte/icons/rows-3';
	import Check from 'lucide-svelte/icons/check';
	import { IconButton } from '$lib/components/ui';
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

	function choose(value: DashLayout) {
		ctx.choose(value);
		open = false;
	}
</script>

<div class="relative">
	<IconButton icon={icon(LayoutTemplate)} label="Change layout" onclick={() => (open = !open)} />
	{#if open}
		<!-- Light-dismiss backdrop: a click anywhere else closes the menu. -->
		<button
			type="button"
			class="fixed inset-0 z-40 cursor-default"
			aria-label="Close layout menu"
			onclick={() => (open = false)}
		></button>
		<div
			class="absolute top-full right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-bg py-1 shadow-lg"
			role="menu"
			transition:fade={{ duration: 120 }}
		>
			{#each options as opt (opt.value)}
				{@const Icon = opt.icon}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={ctx.current === opt.value}
					class="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink transition-colors hover:bg-surface"
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
