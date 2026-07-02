<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { PageServerData, ActionData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	// The user's explicit choice; null until they tap one. The EFFECTIVE selection falls back to
	// the entry (cheapest) bundle so there's always a one-tap path to payment AND the form is
	// submittable on first paint — before client JS hydrates. That matters on slow mobile /
	// captive-portal (CNA) browsers, where there's a window after the HTML loads but before
	// hydration; with this default + the CSS-driven highlight below, picking and submitting work
	// natively in that window.
	let userPick = $state<number | null>(null);
	const selectedId = $derived(userPick ?? data.bundles[0]?.id ?? null);

	let pending = $state(false);

	// Selecting a bundle creates a Maya checkout server-side and 303-redirects to
	// the gateway (an external URL). enhance's default would `goto()` that, which
	// only handles internal nav — so we follow the external location ourselves and
	// keep the button in its pending state until the page unloads.
	const checkout: SubmitFunction = () => {
		pending = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				window.location.href = result.location;
				return;
			}
			pending = false;
			await update();
		};
	};
</script>

<svelte:head>
	<title>Top up · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col p-5 lg:items-center lg:justify-center lg:bg-surface lg:p-8">
	<div
		class="flex w-full flex-1 flex-col lg:max-w-[460px] lg:flex-none lg:rounded-2xl lg:border lg:border-border lg:bg-bg lg:p-7 lg:shadow-sm"
	>
		<a
			href="{resolve('/dashboard')}{data.portalQuery}"
			class="mb-[22px] flex min-h-[44px] items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink"
		>
			<Icon name="arrow-left" size={18} strokeWidth={2.2} />
			Dashboard
		</a>

		<div
			class="mb-6 flex items-center justify-between rounded-2xl border border-border bg-surface px-[18px] py-4"
		>
			<span class="text-[13px] font-medium text-muted">Current balance</span>
			<div class="flex items-baseline gap-1.5">
				<span class="font-mono text-2xl font-semibold text-ink">{data.balance}</span>
				<span class="text-[13px] font-medium text-muted">cr</span>
			</div>
		</div>

		{#if form?.error}
			<p class="mb-4 rounded-lg bg-blocked/10 px-4 py-3 text-sm text-blocked" role="alert">
				{form.error}
			</p>
		{/if}

		{#if data.bundles.length === 0}
			<p class="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
				No credit bundles are available right now. Please check back soon.
			</p>
		{:else}
			<h1 class="mb-3.5 text-[21px] font-bold tracking-tight text-ink">Choose a bundle</h1>

			<!-- `group` + data-pending drive the submit button's spinner via CSS, so it shows the
			instant the button is tapped — even before hydration. `data-pending` is set by the
			pre-hydration inline script (app.html) on a native submit, and by Svelte's `pending`
			state once hydrated; both feed the same `group-data-[pending]` styles below. -->
			<form
				method="post"
				action="?/checkout"
				use:enhance={checkout}
				data-pending-form
				data-pending={pending ? '' : null}
				class="group"
			>
				<fieldset class="mb-6 flex flex-col gap-2.5" disabled={pending}>
					<legend class="sr-only">Choose a credit bundle</legend>
					{#each data.bundles as bundle (bundle.id)}
						<!-- Selection highlight is driven by the radio's :checked state via `has-[:checked]`
						(label border/fill) and `peer-checked` (the dot + credits color), NOT by the JS
						`userPick` state — so the choice reflects visually even before hydration. -->
						<label
							class="flex min-h-[44px] cursor-pointer items-center gap-3.5 rounded-xl border-[1.5px] border-border bg-bg p-4 transition-colors hover:bg-surface has-[:checked]:border-2 has-[:checked]:border-brand has-[:checked]:bg-brand-tint-2"
						>
							<input
								type="radio"
								name="packageId"
								value={bundle.id}
								checked={selectedId === bundle.id}
								onchange={() => (userPick = bundle.id)}
								class="peer sr-only"
							/>
							<span
								class="h-5 w-5 shrink-0 rounded-full border-2 border-border peer-checked:border-[6px] peer-checked:border-brand"
								aria-hidden="true"
							></span>
							<span class="flex flex-1 items-center gap-2">
								<span class="font-mono text-lg font-bold text-ink">₱{bundle.fiatCost}</span>
							</span>
							<span class="font-mono text-[13px] font-semibold text-muted peer-checked:text-brand">
								{bundle.creditsProvided} credits
							</span>
						</label>
					{/each}
				</fieldset>

				<!-- Buyer details required by the payment provider (Maya's Kount fraud protection needs
				a name + email on every checkout). Pre-filled from saved details; Maya's page then uses
				these to pre-fill its own form, so the buyer only enters card details there. -->
				<fieldset class="mb-6 flex flex-col gap-2.5" disabled={pending}>
					<legend class="mb-0.5 text-[15px] font-semibold text-ink">Your details</legend>
					<p class="-mt-1 mb-1.5 text-[11.5px] font-medium text-muted">
						Required by our payment provider to process your payment.
					</p>
					<!-- `defaultValue`/`defaultChecked` (Svelte 5.6+) render as the value/checked attribute
					in SSR so the prefill shows, but on hydration set the element DEFAULT rather than the
					live value — so anything the user typed BEFORE hydration isn't wiped. -->
					<div class="flex gap-2.5">
						<input
							name="firstName"
							type="text"
							autocomplete="given-name"
							placeholder="First name"
							required
							defaultValue={form?.values?.firstName ?? data.buyer.firstName}
							class="h-[48px] w-full rounded-xl border-[1.5px] border-border bg-bg px-4 text-[15px] text-ink transition-colors placeholder:text-muted focus:border-brand focus:outline-none"
						/>
						<input
							name="lastName"
							type="text"
							autocomplete="family-name"
							placeholder="Last name"
							required
							defaultValue={form?.values?.lastName ?? data.buyer.lastName}
							class="h-[48px] w-full rounded-xl border-[1.5px] border-border bg-bg px-4 text-[15px] text-ink transition-colors placeholder:text-muted focus:border-brand focus:outline-none"
						/>
					</div>
					<input
						name="email"
						type="email"
						autocomplete="email"
						placeholder="Email address"
						required
						defaultValue={form?.values?.email ?? data.buyer.email}
						class="h-[48px] w-full rounded-xl border-[1.5px] border-border bg-bg px-4 text-[15px] text-ink transition-colors placeholder:text-muted focus:border-brand focus:outline-none"
					/>
					<label class="mt-0.5 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[13px] text-ink">
						<input
							type="checkbox"
							name="saveDetails"
							defaultChecked={form?.values?.saveDetails ?? data.savedDetails}
							class="h-[18px] w-[18px] shrink-0 rounded border-[1.5px] border-border text-brand accent-brand focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						/>
						Save my details for next time
					</label>
				</fieldset>

				<!-- `selectedId` defaults to the cheapest bundle, so the button is enabled and
				submittable on first paint (pre-hydration). Both the busy and idle labels are always
				rendered; the form's `group-data-[pending]` state shows exactly one — so a native
				pre-hydration submit gets the spinner via the inline script, and a hydrated submit
				gets it via `pending`. The `group-data-[pending]` pointer/opacity also blocks a
				double-tap before `disabled` (JS-only) can. -->
				<button
					type="submit"
					disabled={pending || selectedId === null}
					class="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cta text-base font-bold text-white transition-colors hover:cursor-pointer hover:bg-cta-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cta disabled:cursor-not-allowed disabled:opacity-50 group-data-[pending]:pointer-events-none group-data-[pending]:opacity-50"
				>
					<span class="hidden items-center gap-2 group-data-[pending]:inline-flex">
						<span
							class="inline-block h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white"
							aria-hidden="true"
						></span>
						Redirecting to payment…
					</span>
					<span class="inline-flex items-center gap-2 group-data-[pending]:hidden">
						Continue to payment
						<Icon name="arrow-right" size={18} strokeWidth={2.4} />
					</span>
				</button>
			</form>

			{#if pending}
				<p class="mt-3.5 text-center text-[11.5px] font-medium text-muted">
					Taking you to Maya — don't close this window.
				</p>
			{:else}
				<div class="mt-4 flex items-center justify-center gap-1.5">
					<Icon name="lock" size={13} class="text-muted" />
					<span class="text-[11.5px] font-medium text-muted">
						Secured by Maya · credits added after payment
					</span>
				</div>
			{/if}
		{/if}
	</div>
</main>
