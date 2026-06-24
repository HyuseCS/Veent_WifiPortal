<script lang="ts" generics="T extends string">
	// Segmented tab control with an optional per-tab count — the shared "filter pills"
	// used by the Networks AP grid, the Users status filter, and the Finance period/status
	// selectors. Callers own the active value. Two modes share the same chrome so the pill
	// styling is never re-implemented per page:
	//   • button mode (default) — pass `onselect`; tabs are buttons that fire it.
	//   • link mode — pass `href`; tabs render as `<a>` navigation (e.g. the Finance period
	//     selector, where the active period drives an SSR `?period=` reload).
	let {
		tabs,
		active,
		onselect,
		href,
		class: klass = '',
		compact = false,
		fill = false
	}: {
		tabs: { key: T; label: string; count?: number }[];
		active: T;
		onselect?: (key: T) => void;
		href?: (key: T) => string;
		class?: string;
		compact?: boolean;
		/** Stretch pills to fill the full container width — one row, always balanced. */
		fill?: boolean;
	} = $props();

	const pill = $derived(
		fill || compact
			? 'flex min-h-[36px] cursor-pointer items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-bold transition-colors duration-150'
			: 'flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors duration-150'
	);
	const pillFill = $derived(fill ? 'flex-1' : '');
	const toneFor = (key: T) =>
		active === key ? 'bg-brand text-white' : 'text-muted hover:text-ink';
</script>

<div class="flex rounded-xl border border-border bg-bg shadow-sm {fill || compact ? 'gap-0.5 p-0.5' : 'gap-1 p-1'} {fill ? 'w-full' : ''} {klass}">
	{#each tabs as tab (tab.key)}
		{#if href}
			<a
				href={href(tab.key)}
				aria-current={active === tab.key ? 'page' : undefined}
				class="{pill} {pillFill} {toneFor(tab.key)}"
			>
				{tab.label}{#if tab.count !== undefined}<span class="font-mono text-[11px] opacity-75"
						>{tab.count}</span
					>{/if}
			</a>
		{:else}
			<button
				type="button"
				onclick={() => onselect?.(tab.key)}
				aria-pressed={active === tab.key}
				class="{pill} {pillFill} {toneFor(tab.key)}"
			>
				{tab.label}{#if tab.count !== undefined}<span class="font-mono text-[11px] opacity-75"
						>{tab.count}</span
					>{/if}
			</button>
		{/if}
	{/each}
</div>
