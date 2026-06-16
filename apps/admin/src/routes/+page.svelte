<script lang="ts">
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<main class="prose mx-auto p-8">
	<h1>Veent Admin</h1>
	{#if data.user}
		<p>Signed in as {data.user.name}.</p>
		<a href="/dashboard">Open dashboard</a>
	{:else}
		<p>Staff sign in required.</p>
		<a href="/login">Sign in</a>
	{/if}
</main>
