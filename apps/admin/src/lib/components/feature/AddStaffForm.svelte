<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Card, Field, SectionHeading } from '$lib/components/ui';

	// Owner-only provisioning form. Submitting invites a new admin: the server creates
	// a pending account and "emails" an activation link (stub-logged until SMTP lands).
	// Invitees are always `admin` — there is no other assignable role — so no role input.
	let error = $state('');
	let notice = $state('');
	// Disable the submit button while the invite is in flight (blocks double-submits).
	let submitting = $state(false);
</script>

<Card>
	<SectionHeading title="Add staff member" class="mb-4" />
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
						(result.data as { error?: string } | undefined)?.error ?? 'Could not send invitation.'
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
</Card>
