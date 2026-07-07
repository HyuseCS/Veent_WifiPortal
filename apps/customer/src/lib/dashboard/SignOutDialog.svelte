<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Icon from '$lib/Icon.svelte';

	// The `#signout-confirm` checkbox that toggles this dialog lives in the page (both the
	// app-bar and mobile Sign out controls are <label for="signout-confirm">). This component
	// is just the dialog body; it stays CSS-only (peer-checked) so it works before hydration.
	const signOut: SubmitFunction =
		() =>
		async ({ update }) =>
			update();
</script>

<div
	role="dialog"
	aria-modal="true"
	aria-label="Confirm sign out"
	class="pointer-events-none invisible fixed inset-0 z-50 flex items-end justify-center opacity-0 transition-[opacity,visibility] duration-200 peer-checked:pointer-events-auto peer-checked:visible peer-checked:opacity-100 lg:items-center"
>
	<label for="signout-confirm" aria-label="Cancel" class="absolute inset-0 cursor-default bg-ink/40"
	></label>
	<div
		class="relative z-10 w-full max-w-sm rounded-t-3xl bg-bg px-5 pt-5 pb-6 shadow-[0_-8px_30px_rgba(0,0,0,0.16)] lg:rounded-3xl lg:p-7"
	>
		<div class="mx-auto mb-[18px] h-1 w-9 rounded bg-border lg:hidden"></div>
		<div class="mb-4 flex items-center gap-3">
			<div class="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-brand-tint">
				<Icon name="log-out" size={22} class="text-brand" />
			</div>
			<div>
				<div class="text-[17px] font-bold text-ink">Sign out?</div>
				<div class="text-[12.5px] font-medium text-muted">
					You'll need to verify your number again to get back in.
				</div>
			</div>
		</div>
		<div class="flex gap-2.5">
			<label
				for="signout-confirm"
				class="flex h-[52px] flex-1 items-center justify-center rounded-xl border border-border bg-surface text-[15px] font-semibold text-muted transition-colors hover:cursor-pointer hover:text-ink"
			>
				Cancel
			</label>
			<form
				method="post"
				action="?/signOut"
				use:enhance={signOut}
				class="group flex-1"
				data-pending-form
			>
				<button
					class="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-blocked text-[15px] font-bold text-white transition-colors hover:cursor-pointer group-data-[pending]:pointer-events-none group-data-[pending]:opacity-70"
				>
					<span
						class="hidden h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-white/40 border-t-white group-data-[pending]:inline-block"
						aria-hidden="true"
					></span>
					Sign out
				</button>
			</form>
		</div>
	</div>
</div>
