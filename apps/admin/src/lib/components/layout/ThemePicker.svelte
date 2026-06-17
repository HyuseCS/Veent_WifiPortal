<script lang="ts">
	import { browser } from '$app/environment';

	// Swatch reflects each preset's brand color (matches layout.css presets).
	const presets = [
		{ id: 'teal', label: 'Teal', swatch: 'oklch(0.38 0.13 185)' },
		{ id: 'jade', label: 'Jade', swatch: 'oklch(0.34 0.13 155)' },
		{ id: 'cobalt', label: 'Cobalt', swatch: 'oklch(0.44 0.19 255)' },
		{ id: 'mono', label: 'Mono', swatch: 'oklch(0.14 0.01 200)' }
	];

	let current = $state(browser ? (document.documentElement.dataset.theme ?? 'teal') : 'teal');

	function select(id: string) {
		current = id;
		document.documentElement.dataset.theme = id;
		try {
			localStorage.setItem('veent-admin-theme', id);
		} catch {
			// localStorage unavailable (private mode) — theme still applies for the session.
		}
	}
</script>

<div>
	<p class="px-1 pb-2 text-xs font-semibold tracking-wide text-sidebar-muted uppercase">Theme</p>
	<div class="grid grid-cols-2 gap-1.5">
		{#each presets as preset (preset.id)}
			<button
				type="button"
				onclick={() => select(preset.id)}
				aria-pressed={current === preset.id}
				class="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors {current ===
				preset.id
					? 'bg-white/10 text-sidebar-text ring-1 ring-cta ring-inset'
					: 'text-sidebar-muted hover:bg-white/5'}"
			>
				<span
					class="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-white/20"
					style="background: {preset.swatch}"
				></span>
				{preset.label}
			</button>
		{/each}
	</div>
</div>
