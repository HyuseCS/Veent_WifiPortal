<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';

	const faqs = [
		{
			id: 'account-time',
			q: 'How does my time work?',
			a: 'Your internet time belongs to your account, not to one device. Buy a tier or claim free time once, and it counts down for your whole account — you can use it from your phone and your laptop without paying again.'
		},
		{
			id: 'devices',
			q: 'Why do I see extra devices?',
			a: "iPhones and Macs use a private Wi-Fi address that can change — for example after a software update or if you toggle Wi-Fi settings. When that happens your phone can show up as a new device. It's safe to remove the oldest one; we'll reconnect your phone automatically next time it joins."
		},
		{
			id: 'device-limit',
			q: 'What is the device limit?',
			a: "Your account can be connected on a limited number of devices at once. If you reach the limit, connecting a new device replaces the one you've used least recently. You can also remove devices yourself below your access timer."
		},
		{
			id: 'free-time',
			q: 'How often do I get free time?',
			a: 'Free time is one short session for your whole account, available again every 12 hours. It is shared across your devices — claiming it on one device uses it for the account.'
		},
		{
			id: 'lost-device',
			q: 'I lost a device — how do I disconnect it?',
			a: 'On your dashboard, open "Your devices" and use "Disconnect all". That drops every device from your account immediately; reconnect the ones you still have by opening the portal on each.'
		}
	];
</script>

<svelte:head>
	<title>Help · Veent WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col bg-bg">
	<header class="bg-brand text-white">
		<div class="flex items-center gap-3 px-4 py-4 lg:px-8">
			<a
				href={resolve('/dashboard')}
				aria-label="Back to dashboard"
				class="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white/90 transition-colors hover:bg-white/25 hover:cursor-pointer"
			>
				<Icon name="arrow-left" size={18} />
			</a>
			<h1 class="text-[17px] font-bold">Help & FAQ</h1>
		</div>
	</header>

	<div class="mx-auto w-full max-w-2xl flex-1 px-5 py-6 lg:py-10">
		<div class="flex flex-col gap-3">
			{#each faqs as item (item.id)}
				<section id={item.id} class="rounded-2xl border border-border bg-surface p-[18px] lg:p-6">
					<h2 class="mb-1.5 text-[15px] font-bold text-ink">{item.q}</h2>
					<p class="text-[13.5px] leading-relaxed text-muted">{item.a}</p>
				</section>
			{/each}
		</div>

		<a
			href={resolve('/dashboard')}
			class="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-bold text-white transition-colors hover:bg-brand-hover"
		>
			<Icon name="arrow-left" size={17} />
			Back to dashboard
		</a>
	</div>
</main>
