<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Field } from '$lib/components/ui';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	// Once ?/enable succeeds (or a confirm retry echoes it back), we're on the QR step.
	const onConfirmStep = $derived(form?.step === 'confirm');

	// User must tick "I've saved my backup codes" before they can confirm.
	let savedCodes = $state(false);
	let submitting = $state(false);
</script>

<main class="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
	<div class="w-full max-w-md space-y-6">
		<div class="text-center">
			<span class="text-xl font-semibold tracking-tight text-ink">
				RADIUS <span class="text-muted">Admin</span>
			</span>
			<p class="text-xs text-muted">by Parafiber</p>
			<p class="mt-1 text-sm text-muted">Set up two-factor authentication</p>
		</div>

		{#if !onConfirmStep}
			<!-- Step 1: confirm password to generate a secret -->
			<form
				method="post"
				action="?/enable"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
				class="space-y-4 rounded-xl border border-border bg-bg p-6 shadow-sm"
			>
				<p class="text-sm text-muted">
					Two-factor authentication is required for all staff accounts. Confirm your password to
					begin.
				</p>

				<Field
					id="password"
					name="password"
					label="Password"
					type="password"
					autocomplete="current-password"
					required
				/>

				{#if form?.message}
					<p class="text-xs text-blocked" role="alert">{form.message}</p>
				{/if}

				<Button type="submit" loading={submitting} class="w-full py-2.5">Continue</Button>
			</form>
		{:else}
			<!-- Step 2: scan the QR (or enter the key), save backup codes, confirm a code -->
			<div class="space-y-4 rounded-xl border border-border bg-bg p-6 shadow-sm">
				<div class="space-y-3">
					<p class="text-sm font-medium text-ink">1. Scan this QR code</p>
					<p class="text-xs text-muted">
						Open an authenticator app (Google Authenticator, 1Password, Authy…) and scan:
					</p>
					{#if form?.qrSvg}
						<div class="mx-auto w-44 rounded-lg bg-white p-3">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							{@html form.qrSvg}
						</div>
					{/if}
					{#if form?.secret}
						<p class="text-center text-xs text-muted">
							Can't scan? Enter this key manually:
							<br />
							<span class="font-mono text-sm break-all text-ink select-all">{form.secret}</span>
						</p>
					{/if}
				</div>

				{#if form?.backupCodes?.length}
					<div class="space-y-2 border-t border-border pt-4">
						<p class="text-sm font-medium text-ink">2. Save your backup codes</p>
						<p class="text-xs text-muted">
							Each code works once if you lose your device. Store them somewhere safe — they
							won't be shown again.
						</p>
						<ul class="grid grid-cols-2 gap-1 rounded-lg bg-surface p-3 font-mono text-sm text-ink">
							{#each form.backupCodes as code (code)}
								<li class="select-all">{code}</li>
							{/each}
						</ul>
						<label class="flex items-center gap-2 text-sm text-ink">
							<input type="checkbox" bind:checked={savedCodes} class="size-4" />
							I've saved my backup codes
						</label>
					</div>
				{/if}

				<form
					method="post"
					action="?/confirm"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update();
							submitting = false;
						};
					}}
					class="space-y-3 border-t border-border pt-4"
				>
					<!-- Carry the one-time display data so a mistyped code re-renders it. The QR
					     is NOT carried (it's {@html}-rendered, so only the server may emit it). -->
					<input type="hidden" name="secret" value={form?.secret ?? ''} />
					<input type="hidden" name="backupCodes" value={(form?.backupCodes ?? []).join('\n')} />

					<p class="text-sm font-medium text-ink">3. Enter the 6-digit code</p>
					<Field
						id="code"
						name="code"
						label="Code from your app"
						inputmode="numeric"
						autocomplete="one-time-code"
						required
						class="font-mono tracking-widest"
					/>

					{#if form?.message}
						<p class="text-xs text-blocked" role="alert">{form.message}</p>
					{/if}

					<Button type="submit" loading={submitting} disabled={!savedCodes} class="w-full py-2.5">
						Verify &amp; finish
					</Button>
				</form>
			</div>
		{/if}
	</div>
</main>
