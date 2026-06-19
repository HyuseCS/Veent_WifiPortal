<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { ActionData, PageServerData } from './$types';
	import logo from '$lib/assets/parafiber-logo.webp';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const LENGTH = 6;
	let digits = $state<string[]>(Array(LENGTH).fill(''));
	let inputs = $state<HTMLInputElement[]>([]);
	let submitting = $state(false);
	let resent = $state(false);

	const code = $derived(digits.join(''));
	const complete = $derived(/^\d{6}$/.test(code));

	// Resend gate: a single always-running tick counts the cooldown down to 0,
	// after which the resend control becomes tappable. Resending resets it.
	let secondsLeft = $state(45);
	$effect(() => {
		const id = setInterval(() => {
			secondsLeft = Math.max(0, secondsLeft - 1);
		}, 1000);
		return () => clearInterval(id);
	});

	$effect(() => {
		inputs[0]?.focus();
	});

	const timer = $derived(
		`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
	);

	function handleInput(i: number, event: Event) {
		const el = event.target as HTMLInputElement;
		const v = el.value.replace(/\D/g, '');
		digits[i] = v.slice(-1);
		el.value = digits[i];
		if (digits[i] && i < LENGTH - 1) inputs[i + 1]?.focus();
	}

	function handleKeydown(i: number, event: KeyboardEvent) {
		if (event.key === 'Backspace' && !digits[i] && i > 0) {
			inputs[i - 1]?.focus();
		}
	}

	function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		const text = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, LENGTH);
		if (!text) return;
		const chars = text.split('');
		for (let j = 0; j < LENGTH; j++) digits[j] = chars[j] ?? '';
		inputs[Math.min(chars.length, LENGTH - 1)]?.focus();
	}

	const onVerify: SubmitFunction = () => {
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	};

	const onResend: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update();
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

			<form method="post" action="?/verify" use:enhance={onVerify}>
				<input type="hidden" name="code" value={code} />

				<div class="mb-3 flex gap-2.5">
					{#each digits as digit, i (i)}
						<input
							bind:this={inputs[i]}
							value={digit}
							oninput={(e) => handleInput(i, e)}
							onkeydown={(e) => handleKeydown(i, e)}
							onpaste={handlePaste}
							type="text"
							inputmode="numeric"
							autocomplete={i === 0 ? 'one-time-code' : 'off'}
							maxlength="1"
							aria-label={`Digit ${i + 1}`}
							aria-invalid={form?.message ? 'true' : undefined}
							class="aspect-[1/1.15] max-h-[60px] min-w-0 flex-1 rounded-xl border-[1.5px] text-center font-mono text-2xl font-semibold text-ink transition-colors focus:outline-none focus:ring-[3px] focus:ring-brand/20 {form?.message
								? 'border-blocked bg-blocked/5'
								: digit
									? 'border-brand bg-brand-tint-2'
									: 'border-border bg-bg focus:border-brand'}"
						/>
					{/each}
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
					disabled={!complete || submitting}
					class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-40"
				>
					{#if submitting}
						<span
							class="inline-block h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white"
							aria-hidden="true"
						></span>
						<span class="sr-only">Verifying…</span>
					{:else}
						Verify &amp; connect
					{/if}
				</button>
			</form>

			<div class="mt-5 text-center text-[13px] text-muted">
				{#if resent}
					<span class="font-medium text-online" role="status">A new code is on its way.</span>
				{:else if secondsLeft > 0}
					Didn't get it? Resend code in
					<span class="font-mono font-semibold text-ink">{timer}</span>
				{:else}
					<form method="post" action="?/resend" use:enhance={onResend} class="inline">
						Didn't get it?
						<button type="submit" class="font-semibold text-brand hover:text-brand-hover">
							Resend code
						</button>
					</form>
				{/if}
			</div>
		</div>
	</div>
</main>
