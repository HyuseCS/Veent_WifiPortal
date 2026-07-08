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

	// Light-dismiss: showModal() has no backdrop-close, so close when a click lands outside the
	// panel box (i.e. on the ::backdrop — its target is the <dialog> itself, and the point falls
	// outside its rect). Clicks on the panel's own padding stay inside the rect and don't dismiss.
	function handleBackdropClick(e: MouseEvent) {
		if (!el) return;
		const r = el.getBoundingClientRect();
		const inside =
			e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
		if (!inside) open = false;
	}
</script>

<dialog
	bind:this={el}
	onclose={handleClose}
	onclick={handleBackdropClick}
	class="m-auto w-full {klass} rounded-lg border border-border bg-bg p-6 text-ink backdrop:bg-black/50"
>
	{@render children()}
</dialog>
