<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { ActionData, PageServerData } from './$types';
	import logo from '$lib/assets/parafiber-logo.webp';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const LENGTH = 6;
	let submitting = $state(false);
	let resent = $state(false);

	// Resend gate: a single always-running tick counts the cooldown down to 0,
	// after which the resend control becomes tappable. Resending resets it.
	let secondsLeft = $state(45);
	$effect(() => {
		const id = setInterval(() => {
			secondsLeft = Math.max(0, secondsLeft - 1);
		}, 1000);
		return () => clearInterval(id);
	});

	const timer = $derived(
		`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
	);

	// Strip any non-digits as they're typed so the field only ever holds the code.
	// This is a nicety when hydrated; the server re-strips and re-validates regardless.
	function sanitize(event: Event) {
		const el = event.target as HTMLInputElement;
		const cleaned = el.value.replace(/\D/g, '').slice(0, LENGTH);
		if (el.value !== cleaned) el.value = cleaned;
	}

	const onVerify: SubmitFunction = () => {
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	};

	let resending = $state(false);
	const onResend: SubmitFunction = () => {
		resending = true;
		return async ({ result, update }) => {
			await update();
			resending = false;
			if (result.type === 'success') {
				secondsLeft = 45;
				resent = true;
				setTimeout(() => (resent = false), 4000);
			}
		};
	};
</script>

<svelte:head>
	<title>Enter code · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col lg:bg-surface">
	<div
		class="flex w-full flex-1 flex-col lg:flex-none lg:overflow-hidden"
	>
		<div class="flex items-center bg-brand gap-3 px-5 py-3">
			<a
				href={resolve('/login')}
				aria-label="Back"
				class="flex min-h-8 min-w-8 items-center text-white hover:text-white/80"
			>
				<Icon name="arrow-left" size={20} strokeWidth={2.2} />
			</a>
			<img src={logo} alt="parafiber by parasat logo" class="h-8 w-auto" />
		</div>

		<div class="flex flex-1 flex-col p-5 max-w-lg md:self-center pt-20">
			<h1 class="mb-2 text-[25px] font-bold tracking-tight text-ink">Enter the code</h1>
			<p class="mb-7 text-[14.5px] leading-relaxed text-muted">
				Sent to <strong class="font-semibold text-ink">{data.maskedPhone}</strong>.
			</p>

			<!-- `group` + data-pending drive the button spinner via CSS the instant it's tapped,
			pre-hydration (app.html inline script) and hydrated (`submitting`) alike. The code is a
			single native <input>, so the form is fully submittable with zero JS on slow networks:
			the browser enforces `pattern`/`required`, and the server re-strips + re-validates. -->
			<form
				method="post"
				action="?/verify"
				class="group"
				data-pending-form
				data-pending={submitting ? '' : null}
				use:enhance={onVerify}
			>
				<div class="mb-3">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						name="code"
						oninput={sanitize}
						type="text"
						inputmode="numeric"
						pattern="\d{'{'}{LENGTH}{'}'}"
						maxlength={LENGTH}
						required
						autofocus
						autocomplete="one-time-code"
						aria-label="6-digit code"
						aria-invalid={form?.message ? 'true' : undefined}
						placeholder="••••••"
						class="h-[60px] w-full rounded-xl border-[1.5px] text-center font-mono text-3xl font-semibold tracking-[0.4em] text-ink transition-colors focus:outline-none focus:ring-[3px] focus:ring-brand/20 {form?.message
							? 'border-blocked bg-blocked/5'
							: 'border-border bg-bg focus:border-brand'}"
					/>
				</div>

				{#if form?.message}
					<div class="mb-5 flex items-center gap-1.5" role="alert">
						<Icon name="alert-circle" size={14} strokeWidth={2.2} class="text-blocked" />
						<span class="text-[12.5px] font-medium text-blocked">{form.message}</span>
					</div>
				{:else}
					<div class="mb-5"></div>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-40 group-data-[pending]:pointer-events-none group-data-[pending]:opacity-80"
				>
					<span class="hidden items-center gap-2 group-data-[pending]:inline-flex">
						<span
							class="inline-block h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white"
							aria-hidden="true"
						></span>
						<span class="sr-only">Verifying…</span>
					</span>
					<span class="inline-flex items-center gap-2 group-data-[pending]:hidden">
						Verify
					</span>
				</button>
			</form>

			<div class="mt-5 text-center text-[13px] text-muted">
				{#if resent}
					<span class="font-medium text-online" role="status">A new code is on its way.</span>
				{:else if secondsLeft > 0}
					Didn't get it? Resend code in
					<span class="font-mono font-semibold text-ink">{timer}</span>
				{:else}
					<!-- The resend form POSTs natively (no JS needed), so the pre-hydration
					data-pending feedback is a real win here, not just cosmetic. -->
					<form
						method="post"
						action="?/resend"
						use:enhance={onResend}
						class="group inline"
						data-pending-form
						data-pending={resending ? '' : null}
					>
						Didn't get it?
						<button
							type="submit"
							disabled={resending}
							class="font-semibold text-brand hover:text-brand-hover group-data-[pending]:pointer-events-none group-data-[pending]:opacity-60"
						>
							<span class="group-data-[pending]:hidden">Resend code</span>
							<span class="hidden group-data-[pending]:inline">Sending…</span>
						</button>
					</form>
				{/if}
			</div>
		</div>
	</div>
</main>
