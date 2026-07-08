<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	// One label/value row in the profile modal's definition lists. Renders an em-dash when
	// the value is empty so unset fields read as "not set" rather than blank. An optional
	// leading icon and `mono` (for dates/times/ids) match the dashboard's data typography.
	// Pass `children` instead of `value` when the value needs markup (e.g. an icon + text).
	let {
		label,
		value = null,
		mono = false,
		icon,
		children
	}: {
		label: string;
		value?: string | null;
		mono?: boolean;
		icon?: Component;
		children?: Snippet;
	} = $props();

	const Icon = $derived(icon);
	const empty = $derived(!children && !(value && value.trim()));
</script>

<div class="flex min-w-0 flex-col gap-0.5 py-1.5">
	<dt class="text-xs font-medium text-muted">{label}</dt>
	<!-- min-w-0 + break-words so a long email/phone wraps instead of overflowing on narrow
	     (mobile) widths. -->
	<dd class="flex min-w-0 items-center gap-1.5 text-sm break-words {mono ? 'font-mono' : ''} {empty ? 'text-muted' : 'text-ink'}">
		{#if Icon}<Icon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{/if}
		{#if children}{@render children()}{:else}{empty ? '—' : value}{/if}
	</dd>
</div>
