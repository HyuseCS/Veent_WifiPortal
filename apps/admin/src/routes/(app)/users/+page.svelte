<script lang="ts">
	import { UsersTable } from '$lib/components/feature';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const users = $derived(data.users);
</script>

<div class="space-y-4">
	<p class="text-sm text-muted">{users.length} registered users.</p>
	<UsersTable {users} />
</div>
