<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<main class="prose mx-auto p-8">
	<h1>Veent WiFi</h1>
	{#if data.user}
		<p>You're signed in as {data.user.name}. You're good to go.</p>
		<a href="/connected">Go to your connection</a>
	{:else}
		<p>Sign in to connect to the network.</p>
		<a href="/login">Sign in / Register</a>
	{/if}
</main>
