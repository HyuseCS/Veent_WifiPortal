<script lang="ts">
	let { label = 'Live' }: { label?: string } = $props();
</script>

<span class="relative flex h-2 w-2" aria-label={label}>
	<span
		class="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-60"
	></span>
	<span class="relative inline-flex h-2 w-2 rounded-full bg-online"></span>
</span>
