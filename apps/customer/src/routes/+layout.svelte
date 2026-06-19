<script lang="ts">
	import './layout.css';
	import Toast from '$lib/Toast.svelte';

	const { children } = $props();
</script>

<Toast />
{@render children()}
