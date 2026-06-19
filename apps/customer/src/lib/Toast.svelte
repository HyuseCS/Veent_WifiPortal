<script lang="ts">
	import { fade } from 'svelte/transition';
	import { toasts } from '$lib/toast.svelte';
</script>

<div class="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
	{#each toasts.items as toast (toast.id)}
		<div
			role="status"
			aria-live="polite"
			transition:fade={{ duration: 200 }}
			class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg
				{toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}"
		>
			<svg
				class="mt-0.5 size-5 shrink-0"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				{#if toast.type === 'success'}
					<path d="M21.801 10A10 10 0 1 1 17 3.335" />
					<path d="m9 11 3 3L22 4" />
				{:else}
					<circle cx="12" cy="12" r="10" />
					<path d="m15 9-6 6" />
					<path d="m9 9 6 6" />
				{/if}
			</svg>
			<span>{toast.message}</span>
		</div>
	{/each}
</div>
