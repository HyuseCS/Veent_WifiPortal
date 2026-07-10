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
	 * `padded` (default true) is the inner p-6; pass false for a full-bleed body that fills the
	 * panel edge-to-edge (e.g. a table that IS the modal).
	 */
	let {
		open = $bindable(false),
		reset,
		class: klass = 'max-w-sm',
		padded = true,
		children
	}: {
		open?: boolean;
		reset?: () => void;
		class?: string;
		padded?: boolean;
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

	// Light-dismiss: showModal() has no backdrop-close, so close when a genuine click lands on the
	// ::backdrop. A coordinate-only check is not enough (L1): Firefox dispatches keyboard-activated
	// button clicks with clientX/Y = 0 (which read as "outside" and wrongly closed the modal), and a
	// text-selection drag that starts inside an input but ends over the backdrop fires a click on
	// <dialog> with outside coords (closing the form mid-edit). So we require BOTH: the pointer press
	// STARTED on the backdrop, AND the resulting click's target IS the <dialog> with outside coords.
	let pressedOnBackdrop = false;

	function isOutsidePanel(e: { clientX: number; clientY: number }): boolean {
		if (!el) return false;
		const r = el.getBoundingClientRect();
		const inside =
			e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
		return !inside;
	}

	function handleBackdropPointerDown(e: PointerEvent) {
		pressedOnBackdrop = e.target === el && isOutsidePanel(e);
	}

	function handleBackdropClick(e: MouseEvent) {
		const dismiss = pressedOnBackdrop && e.target === el && isOutsidePanel(e);
		pressedOnBackdrop = false;
		if (dismiss) open = false;
	}
</script>

<dialog
	bind:this={el}
	onclose={handleClose}
	onpointerdown={handleBackdropPointerDown}
	onclick={handleBackdropClick}
	class="m-auto w-full {klass} overflow-hidden rounded-lg border border-border bg-bg text-ink backdrop:bg-black/50 {padded
		? 'p-6'
		: ''}"
>
	{@render children()}
</dialog>
