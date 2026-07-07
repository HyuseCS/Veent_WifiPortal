<script lang="ts">
	import { enhance } from '$app/forms';
	import { Card, Button, Field, SectionHeading } from '$lib/components/ui';
	import AvatarUpload from '$lib/components/feature/AvatarUpload.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Which action is mid-submit — drives the per-form spinner. One page, many forms.
	let busy = $state<string | null>(null);
	function submit(action: string) {
		return () => {
			busy = action;
			return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
				// reset:false keeps typed values visible; the action result still flows into `form`.
				await update({ reset: false });
				busy = null;
			};
		};
	}

	// The 2FA card is showing the "scan the new QR + confirm" step.
	const twofaConfirm = $derived(form?.action === 'twofa' && form?.step === 'confirm');

	// `form` is a union across all the actions; only the profile/email failures echo `values`.
	// Read it through a loose view so the input value-echoes typecheck without narrowing each use.
	const vals = $derived(
		(form as { values?: Record<string, string> } | null)?.values
	);
</script>

{#snippet feedback(action: string, okMsg: string)}
	{#if form?.action === action && form?.error}
		<p class="rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{form.error}</p>
	{:else if form?.action === action && form?.ok}
		<p class="rounded-lg bg-online/10 px-4 py-3 text-sm text-online" role="status">{okMsg}</p>
	{/if}
{/snippet}

{#snippet backupCodes(codes: string[])}
	<div class="rounded-lg border border-highlight/30 bg-highlight/5 p-4">
		<p class="mb-2 text-sm font-semibold text-ink">Save these backup codes</p>
		<p class="mb-3 text-xs text-muted">
			Each works once if you lose your authenticator. They're shown only now — store them somewhere safe.
		</p>
		<ul class="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-ink sm:grid-cols-2">
			{#each codes as code (code)}
				<li>{code}</li>
			{/each}
		</ul>
	</div>
{/snippet}

<div class="mx-auto max-w-2xl space-y-6 pb-10">
	<header>
		<h1 class="text-xl font-semibold text-ink">Profile settings</h1>
		<p class="mt-1 text-sm text-muted">Manage your photo, details, sign-in and two-factor security.</p>
	</header>

	<!-- Profile photo -->
	<Card>
		<SectionHeading title="Profile photo" />
		<div class="mt-4 space-y-4">
			<form id="avatar-save" method="post" action="?/saveAvatar" use:enhance={submit('avatar')}>
				<AvatarUpload
					current={data.profile.image}
					name={data.profile.name}
					email={data.profile.email}
					disabled={busy === 'avatar'}
				/>
			</form>
			{@render feedback('avatar', form?.removed ? 'Photo removed.' : 'Photo updated.')}
			<div class="flex items-center gap-2">
				<Button type="submit" form="avatar-save" loading={busy === 'avatar'}>Save photo</Button>
				{#if data.profile.image}
					<!-- Own (associated) form so its submit + spinner are independent of Save. -->
					<Button variant="danger" type="submit" form="avatar-remove" loading={busy === 'avatar-remove'}>
						Remove
					</Button>
				{/if}
			</div>
			{#if data.profile.image}
				<form
					id="avatar-remove"
					method="post"
					action="?/removeAvatar"
					use:enhance={submit('avatar-remove')}
					class="hidden"
				></form>
			{/if}
		</div>
	</Card>

	<!-- Name + contact info -->
	<Card>
		<SectionHeading title="Your details" />
		<form method="post" action="?/saveProfile" use:enhance={submit('profile')} class="mt-4 space-y-4">
			<Field
				id="name"
				label="Display name"
				autocomplete="name"
				required
				value={vals?.name ?? data.profile.name}
			/>
			<Field
				id="jobTitle"
				name="jobTitle"
				label="Job title"
				placeholder="e.g. Network Lead"
				autocomplete="organization-title"
				value={vals?.jobTitle ?? (data.profile.jobTitle ?? '')}
			/>
			<Field
				id="phone"
				label="Phone number"
				type="tel"
				inputmode="tel"
				autocomplete="tel"
				placeholder="e.g. +63 917 123 4567"
				value={vals?.phone ?? (data.profile.phone ?? '')}
			/>
			<Field
				id="contactEmail"
				name="contactEmail"
				label="Contact email"
				type="email"
				autocomplete="email"
				placeholder="A reach-me address (separate from sign-in)"
				value={vals?.contactEmail ?? (data.profile.contactEmail ?? '')}
			/>
			{@render feedback('profile', 'Details saved.')}
			<Button type="submit" loading={busy === 'profile'}>Save details</Button>
		</form>
	</Card>

	<!-- Login email -->
	<Card>
		<SectionHeading title="Sign-in email" />
		<p class="mt-1 text-sm text-muted">
			You sign in with <span class="font-medium text-ink">{data.profile.email}</span>. Changing it
			needs your authenticator code.
		</p>
		<form method="post" action="?/changeEmail" use:enhance={submit('email')} class="mt-4 space-y-4">
			<Field
				id="email"
				label="New email"
				type="email"
				autocomplete="off"
				required
				value={vals?.email ?? ''}
			/>
			<Field
				id="email-code"
				name="code"
				label="Authenticator code"
				inputmode="numeric"
				autocomplete="one-time-code"
				placeholder="6-digit code"
				maxlength={6}
				required
				class="font-mono tracking-widest"
			/>
			{@render feedback('email', 'Sign-in email updated.')}
			<Button type="submit" loading={busy === 'email'}>Update email</Button>
		</form>
	</Card>

	<!-- Password -->
	<Card>
		<SectionHeading title="Password" />
		<form method="post" action="?/changePassword" use:enhance={submit('password')} class="mt-4 space-y-4">
			<Field id="currentPassword" label="Current password" type="password" autocomplete="current-password" required />
			<Field id="newPassword" label="New password" type="password" autocomplete="new-password" required minlength={8} />
			<Field id="confirmPassword" label="Confirm new password" type="password" autocomplete="new-password" required minlength={8} />
			<Field
				id="password-code"
				name="code"
				label="Authenticator code"
				inputmode="numeric"
				autocomplete="one-time-code"
				placeholder="6-digit code"
				maxlength={6}
				required
				class="font-mono tracking-widest"
			/>
			{@render feedback('password', 'Password changed. Other sessions were signed out.')}
			<Button type="submit" loading={busy === 'password'}>Change password</Button>
		</form>
	</Card>

	<!-- Two-factor -->
	<Card>
		<SectionHeading title="Two-factor authentication" />
		<p class="mt-1 text-sm text-muted">
			Two-factor is required for all staff. Re-enroll to move to a new authenticator, or refresh your backup codes.
		</p>

		{#if twofaConfirm}
			<!-- Rotation in progress: scan the new secret and confirm a code to finish. -->
			<div class="mt-4 space-y-4">
				<p class="text-sm text-ink">Scan this with your authenticator app, then enter a code to finish.</p>
				<div class="flex flex-wrap items-start gap-5">
					<div class="w-40 shrink-0 rounded-lg border border-border bg-white p-2">
						<!-- Server-rendered SVG (uqr) — safe to inline. -->
						{@html form?.qrSvg ?? ''}
					</div>
					<div class="min-w-0 flex-1 space-y-2">
						<p class="text-xs text-muted">Can't scan? Enter this key manually:</p>
						<code class="block break-all rounded bg-surface px-3 py-2 font-mono text-xs text-ink">{form?.secret}</code>
					</div>
				</div>
				{#if form?.backupCodes?.length}
					{@render backupCodes(form.backupCodes)}
				{/if}
				<form method="post" action="?/reenroll2faConfirm" use:enhance={submit('twofa')} class="space-y-4">
					<input type="hidden" name="secret" value={form?.secret ?? ''} />
					<input type="hidden" name="backupCodes" value={(form?.backupCodes ?? []).join('\n')} />
					<Field
						id="twofa-code"
						name="code"
						label="Authenticator code"
						inputmode="numeric"
						autocomplete="one-time-code"
						placeholder="6-digit code"
						maxlength={6}
						required
						class="font-mono tracking-widest"
					/>
					{#if form?.action === 'twofa' && form?.error}
						<p class="rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{form.error}</p>
					{/if}
					<Button type="submit" loading={busy === 'twofa'}>Finish re-enrollment</Button>
				</form>
			</div>
		{:else}
			<div class="mt-4 grid gap-6 sm:grid-cols-2">
				<!-- Re-enroll -->
				<form method="post" action="?/reenroll2faStart" use:enhance={submit('twofa')} class="space-y-3">
					<p class="text-sm font-medium text-ink">Re-enroll authenticator</p>
					<Field id="reenroll-password" name="password" label="Confirm password" type="password" autocomplete="current-password" required />
					<Button variant="secondary" type="submit" loading={busy === 'twofa'}>Start re-enrollment</Button>
				</form>

				<!-- Regenerate backup codes -->
				<form method="post" action="?/regenBackupCodes" use:enhance={submit('backup')} class="space-y-3">
					<p class="text-sm font-medium text-ink">Backup codes</p>
					<Field id="backup-password" name="password" label="Confirm password" type="password" autocomplete="current-password" required />
					<Button variant="secondary" type="submit" loading={busy === 'backup'}>Regenerate codes</Button>
				</form>
			</div>

			{#if form?.action === 'twofa' && form?.error}
				<p class="mt-4 rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{form.error}</p>
			{:else if form?.action === 'twofa' && form?.reenrolled && form?.ok}
				<p class="mt-4 rounded-lg bg-online/10 px-4 py-3 text-sm text-online" role="status">
					Authenticator re-enrolled.
				</p>
			{/if}
			{#if form?.action === 'backup' && form?.error}
				<p class="mt-4 rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">{form.error}</p>
			{:else if form?.action === 'backup' && form?.ok && form?.backupCodes?.length}
				<div class="mt-4">{@render backupCodes(form.backupCodes)}</div>
			{/if}
		{/if}
	</Card>
</div>
