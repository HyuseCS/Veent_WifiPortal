<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	// Admin-managed via the admin Content Management → FAQ section (DB-backed).
	let { data }: { data: PageData } = $props();
	const faqs = $derived(data.faqs);
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
				<section
					id="faq-{item.id}"
					class="rounded-2xl border border-border bg-surface p-[18px] lg:p-6"
				>
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
