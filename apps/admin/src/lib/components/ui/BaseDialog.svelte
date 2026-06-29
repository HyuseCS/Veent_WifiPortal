<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Native <dialog> wrapper. Drives showModal()/close() from `open`, runs an optional
	 * `reset` each time it opens, and — the audit #3 a11y fix — restores focus to the
	 * control that opened it on close. showModal() already provides the focus-trap,
	 * Esc-to-close, aria-modal, and inert backdrop, so this only adds focus-restore plus
	 * the open/close boilerplate the admin dialogs each hand-rolled.
	 *
	 * `class` overrides only the width (default max-w-sm); the rest of the chrome is shared.
	 */
	let {
		open = $bindable(false),
		reset,
		class: klass = 'max-w-sm',
		children
	}: {
		open?: boolean;
		reset?: () => void;
		class?: string;
		children: Snippet;
	} = $props();

	let el = $state<HTMLDialogElement>();
	let restoreFocusTo: HTMLElement | null = null;

	$effect(() => {
		if (open) {
			// Capture the trigger before showModal() pulls focus into the dialog.
			restoreFocusTo = (document.activeElement as HTMLElement) ?? null;
			reset?.();
			el?.showModal();
		} else {
			el?.close();
		}
	});

	function handleClose() {
		open = false;
		restoreFocusTo?.focus();
		restoreFocusTo = null;
	}
</script>

<dialog
	bind:this={el}
	onclose={handleClose}
	class="m-auto w-full {klass} rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
>
	{@render children()}
</dialog>
