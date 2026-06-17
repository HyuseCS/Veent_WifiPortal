<script lang="ts">
	import type { StatusTone } from '$lib/types';

	let { tone, label }: { tone: StatusTone; label: string } = $props();

	// Full class strings (not interpolated) so Tailwind's scanner sees them.
	const fill: Record<StatusTone, string> = {
		online: 'bg-online/15 text-online',
		warning: 'bg-warning/15 text-warning',
		blocked: 'bg-blocked/15 text-blocked'
	};
	const dot: Record<StatusTone, string> = {
		online: 'bg-online',
		warning: 'bg-warning',
		blocked: 'bg-blocked'
	};
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium {fill[tone]}"
>
	<span class="h-1.5 w-1.5 rounded-full {dot[tone]}" aria-hidden="true"></span>
	{label}
</span>
