<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<main class="prose mx-auto p-8">
	<h1>You're connected, {data.user.name}!</h1>
	<p>Your user ID is {data.user.id}.</p>
	<form method="post" action="?/signOut" use:enhance>
		<button class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
			Sign out
		</button>
	</form>
</main>
