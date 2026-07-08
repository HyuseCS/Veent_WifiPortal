<script lang="ts">
	import Activity from 'lucide-svelte/icons/activity';
	import type { Component } from 'svelte';
	import { EmptyState } from '$lib/components/ui';

	// Shown when the Sentry API creds are unset ({ configured: false }). Same icon + title on the
	// dashboard and the mobile issues page; only the description differs (issues vs issues+volume).
	let { description }: { description: string } = $props();
</script>

<EmptyState
	icon={Activity as unknown as Component}
	title="Sentry API not configured"
	{description}
/>
