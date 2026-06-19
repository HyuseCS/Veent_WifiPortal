<script lang="ts">
	import Sun from 'lucide-svelte/icons/sun';
	import Moon from 'lucide-svelte/icons/moon';
	import { browser } from '$app/environment';

	const modes = [
		{ id: 'light', label: 'Light', icon: Sun },
		{ id: 'dark', label: 'Dark', icon: Moon }
	] as const;

	let current = $state(browser ? (document.documentElement.dataset.theme ?? 'light') : 'light');

	function select(id: string) {
		current = id;
		document.documentElement.dataset.theme = id;
		try {
			localStorage.setItem('radius-admin-theme', id);
		} catch {
			// localStorage unavailable (private mode) — mode still applies for the session.
		}
	}
</script>

<div>
	<p class="px-1 pb-2 text-xs font-semibold tracking-wide text-sidebar-muted uppercase">Mode</p>
	<div class="grid grid-cols-2 gap-1.5">
		{#each modes as mode (mode.id)}
			{@const Icon = mode.icon}
			<button
				type="button"
				onclick={() => select(mode.id)}
				aria-pressed={current === mode.id}
				class="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-md px-2.5 text-xs font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cta/60 active:scale-95 {current ===
				mode.id
					? 'bg-white/10 text-sidebar-text ring-1 ring-cta ring-inset'
					: 'text-sidebar-muted hover:bg-white/5 hover:text-sidebar-text'}"
			>
				<Icon class="h-4 w-4" aria-hidden="true" />
				{mode.label}
			</button>
		{/each}
	</div>
</div>
