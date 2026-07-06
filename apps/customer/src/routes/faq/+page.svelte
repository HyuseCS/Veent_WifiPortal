<script lang="ts">
	import Icon from '$lib/Icon.svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	// Admin-managed via the admin Content Management → FAQ section (DB-backed).
	let { data }: { data: PageData } = $props();
	const faqs = $derived(data.faqs);

	// Independent disclosures — tap a question to reveal its answer (a long, all-expanded list is a
	// lot of scrolling on a phone). State only; the reveal/entrance MOTION is CSS, gated on
	// prefers-reduced-motion so motion-sensitive users (and the a11y audit) get the static version.
	let open = $state<Record<number, boolean>>({});
	const toggle = (id: number) => (open[id] = !open[id]);
</script>

<svelte:head>
	<title>Help · Parafiber WiFi</title>
</svelte:head>

<main class="flex min-h-screen flex-col bg-bg">
	<header class="bg-brand text-white">
		<div class="flex items-center gap-3 px-4 py-4 lg:px-8">
			<a
				href={resolve('/dashboard')}
				aria-label="Back to dashboard"
				title="Back to dashboard"
				class="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white/90 transition-colors hover:bg-white/25 hover:cursor-pointer"
			>
				<Icon name="arrow-left" size={18} />
			</a>
			<h1 class="text-[17px] font-bold">Help & FAQ</h1>
		</div>
	</header>

	<div class="mx-auto w-full max-w-2xl flex-1 px-5 py-6 lg:py-10">
		<div class="flex flex-col gap-3">
			{#each faqs as item, i (item.id)}
				<section
					id="faq-{item.id}"
					style="--i: {i}"
					class="faq-card overflow-hidden rounded-2xl border border-border bg-surface"
				>
					<button
						type="button"
						onclick={() => toggle(item.id)}
						aria-expanded={!!open[item.id]}
						aria-controls="faq-answer-{item.id}"
						class="flex w-full items-center justify-between gap-3 p-[18px] text-left transition-colors hover:cursor-pointer hover:bg-cta-tint lg:p-6 motion-safe:transition-[background-color,transform] motion-safe:active:scale-[0.99]"
					>
						<h2 id="faq-q-{item.id}" class="text-[15px] font-bold text-ink">{item.q}</h2>
						<span class="faq-chevron shrink-0 text-muted" class:open={open[item.id]} aria-hidden="true">
							<Icon name="chevron-right" size={18} />
						</span>
					</button>
					<div
						id="faq-answer-{item.id}"
						role="region"
						aria-labelledby="faq-q-{item.id}"
						class="faq-answer"
						class:open={open[item.id]}
					>
						<div class="min-h-0 overflow-hidden">
							<p
								class="border-t border-border/70 px-[18px] py-[15px] text-[13.5px] leading-relaxed text-muted lg:px-6"
							>
								{item.a}
							</p>
						</div>
					</div>
				</section>
			{:else}
				<div
					class="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-6 py-12 text-center"
				>
					<Icon name="help-circle" size={28} class="text-muted" />
					<p class="text-[14px] font-medium text-ink">No help articles yet</p>
					<p class="text-[13px] leading-relaxed text-muted">
						There's nothing here right now. Check back later.
					</p>
				</div>
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

<style>
	/* Accordion: the answer is a grid row that collapses to 0fr and expands to 1fr. The inner
	 * wrapper holds `overflow: hidden; min-height: 0` so the content clips cleanly while collapsed. */
	.faq-answer {
		display: grid;
		grid-template-rows: 0fr;
	}
	.faq-answer.open {
		grid-template-rows: 1fr;
	}
	.faq-chevron {
		display: inline-flex;
	}
	/* chevron-right (▶) points down (▼) when the item is open. */
	.faq-chevron.open {
		transform: rotate(90deg);
	}

	/* ALL motion lives behind the guard: reduced-motion users get instant open/close, a snapping
	 * chevron, and no entrance animation. Animate transform/opacity/grid-rows only (compositor-
	 * friendly) — no layout-thrashing height/top. */
	@media (prefers-reduced-motion: no-preference) {
		.faq-answer {
			transition: grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1);
		}
		.faq-chevron {
			transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
		}
		.faq-card {
			opacity: 0;
			animation: faq-in 280ms ease forwards;
			/* staggered entrance, capped so a long list never feels slow */
			animation-delay: min(calc(var(--i) * 45ms), 280ms);
		}
		@keyframes faq-in {
			from {
				opacity: 0;
				transform: translateY(8px);
			}
			to {
				opacity: 1;
				transform: none;
			}
		}
	}
</style>
