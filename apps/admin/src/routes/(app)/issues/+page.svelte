<script lang="ts">
	import { IssuesTable, IssueForm, MyIssuesList } from '$lib/components/feature';
	import type { AdminIssueRow } from '$lib/server/issues';
	import type { PageData } from './$types';

	// Role-aware Issues page. Managers (owner / system_admin) get the full board + create/edit
	// modal; other admins get a read+update "My Issues" list. Access is enforced server-side in
	// the load (data.canManage), not by hiding UI.
	let { data }: { data: PageData } = $props();

	let formOpen = $state(false);
	let editing = $state<AdminIssueRow | null>(null);

	function openNew() {
		editing = null;
		formOpen = true;
	}
	function openEdit(issue: AdminIssueRow) {
		editing = issue;
		formOpen = true;
	}
</script>

{#if data.canManage}
	<div class="flex h-full flex-col gap-5">
		<IssuesTable issues={data.issues} events={data.events} onnew={openNew} onedit={openEdit} />
	</div>
	<IssueForm
		bind:open={formOpen}
		issue={editing}
		staff={data.assignableStaff}
		networks={data.networks}
		sentryIssues={data.sentryIssues}
		sentryConfigured={data.sentryConfigured}
	/>
{:else}
	<MyIssuesList issues={data.issues} pool={data.pool} networks={data.networks} />
{/if}
