<script lang="ts">
	import { UsersTable } from '$lib/components/feature';
	// MOCK: replace with load() data when backend lands.
	import { users } from '$lib/mocks';
</script>

<div class="space-y-4">
	<p class="text-sm text-muted">{users.length} registered users.</p>
	<UsersTable {users} />
</div>
