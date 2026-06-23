<script lang="ts">
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import { slide } from 'svelte/transition';
	import { enhance } from '$app/forms';
	import { Button, Card, Field } from '$lib/components/ui';

	// Owner-only provisioning form. Submitting invites a new admin: the server creates
	// a pending account and "emails" an activation link (stub-logged until SMTP lands).
	// Invitees are always `admin` — there is no other assignable role — so no role input.
	// Collapsible: the card header toggles the body so the form stays out of the way
	// until the owner wants to add someone (the table is the primary content).
	let error = $state('');
	let notice = $state('');
	// Disable the submit button while the invite is in flight (blocks double-submits).
	let submitting = $state(false);
	let open = $state(false);
</script>

<Card padding="p-0" class={open ? 'border-brand' : ''}>
	<button
		type="button"
		onclick={() => (open = !open)}
		aria-expanded={open}
		class="flex w-full cursor-pointer items-center gap-3 p-5 text-left"
	>
		<span
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
			aria-hidden="true"
		>
			<UserPlus class="h-5 w-5" />
		</span>
		<span class="min-w-0">
			<span class="block font-semibold text-ink">Add staff member</span>
			<span class="block text-xs text-muted">Invite a new admin by email</span>
		</span>
		<ChevronDown
			class="ml-auto h-5 w-5 text-muted transition-transform duration-200 {open
				? 'rotate-180'
				: ''}"
			aria-hidden="true"
		/>
	</button>

	{#if open}
		<div transition:slide={{ duration: 200 }} class="border-t border-border p-5 pt-4">
			<form
				class="space-y-4"
				method="post"
				action="?/invite"
				use:enhance={() => {
					submitting = true;
					return async ({ result, update }) => {
						if (result.type === 'success') {
							const email = (result.data as { email?: string } | undefined)?.email;
							notice = email ? `Activation email sent to ${email}.` : 'Invitation sent.';
							error = '';
							await update(); // reset the form + refresh the staff list
						} else if (result.type === 'failure') {
							error = String(
								(result.data as { error?: string } | undefined)?.error ??
									'Could not send invitation.'
							);
							notice = '';
						} else {
							await update();
						}
						submitting = false;
					};
				}}
			>
				<div class="grid gap-4 sm:grid-cols-2">
					<Field id="name" label="Full name" autocomplete="off" required />
					<Field id="email" label="Email" type="email" autocomplete="off" required />
				</div>

				<p class="text-xs text-muted">
					We'll email an activation link to this address. The member sets their own password and
					activates their account from that link before they can sign in.
				</p>

				{#if error}
					<p class="animate-fade-in-up text-sm text-blocked" role="alert">{error}</p>
				{:else if notice}
					<p class="animate-fade-in-up text-sm text-online" role="status">{notice}</p>
				{/if}

				<div class="flex justify-end">
					<Button type="submit" loading={submitting}>Send invitation</Button>
				</div>
			</form>
		</div>
	{/if}
</Card>
