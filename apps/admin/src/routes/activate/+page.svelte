<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { Button, Field } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const token = $derived(page.url.searchParams.get('token') ?? '');
</script>

<main class="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
	<div class="w-full max-w-sm space-y-6">
		<div class="text-center">
			<span class="text-xl font-semibold tracking-tight text-ink">
				Veent <span class="text-muted">Admin</span>
			</span>
			<p class="mt-1 text-sm text-muted">Activate your staff account</p>
		</div>

		{#if !data.hasToken}
			<div class="rounded-xl border border-border bg-bg p-6 text-center text-sm text-muted">
				This activation link is missing its token. Ask the owner to resend your invitation.
			</div>
		{:else}
			<form
				method="post"
				use:enhance
				class="space-y-4 rounded-xl border border-border bg-bg p-6 shadow-sm"
			>
				<input type="hidden" name="token" value={token} />
				<p class="text-xs text-muted">Set a password to finish activating your account.</p>

				<Field
					id="password"
					label="New password"
					type="password"
					autocomplete="new-password"
					minlength={8}
					required
				/>
				<Field
					id="confirm"
					label="Confirm password"
					type="password"
					autocomplete="new-password"
					minlength={8}
					required
				/>

				{#if form?.message}
					<p class="text-xs text-blocked" role="alert">{form.message}</p>
				{/if}

				<Button type="submit" class="w-full py-2.5">Activate account</Button>
			</form>
		{/if}
	</div>
</main>
