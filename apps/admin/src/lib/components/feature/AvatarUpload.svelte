<script lang="ts">
	import { Avatar, Button } from '$lib/components/ui';

	// Avatar picker: resizes/compresses the chosen file entirely in the browser (canvas → WebP
	// data-URI) so the server only ever stores a small string in admin_user.image — no upload
	// pipeline or image library needed. Exposes the result through a hidden <input name="image">
	// that the surrounding <form> submits. `disabled` mirrors the form's pending state.
	let {
		current = null,
		name = null,
		email = null,
		disabled = false
	}: {
		current?: string | null;
		name?: string | null;
		email?: string | null;
		disabled?: boolean;
	} = $props();

	const MAX_DIM = 256; // longest edge, px
	const QUALITY = 0.82;

	// `picked` is the newly-chosen (resized) data-URI, null until the user picks one. The preview
	// prefers it, else the saved image; the hidden input submits `picked ?? ''` (empty = no change).
	let picked = $state<string | null>(null);
	let error = $state('');
	let inputEl = $state<HTMLInputElement>();

	const preview = $derived(picked ?? current);

	// After a save/remove the parent passes a new `current` — drop the local pick so the preview
	// follows the saved value again (and a removed avatar clears instead of showing the old pick).
	$effect(() => {
		void current;
		picked = null;
	});

	async function onPick(e: Event) {
		error = '';
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			error = 'Choose an image file.';
			return;
		}
		try {
			const resized = await downscale(file, MAX_DIM);
			// base64 is ~1.37× the byte size; keep well under the server's ~60KB cap.
			if (resized.length > 80 * 1024) {
				error = 'That image is too detailed to compress small enough — try another.';
				return;
			}
			picked = resized;
		} catch {
			error = "Couldn't read that image.";
		}
	}

	/** Draw the file onto a canvas scaled to <= max px on its longest edge, export compressed WebP. */
	function downscale(file: File, max: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			const url = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(url);
				const scale = Math.min(1, max / Math.max(img.width, img.height));
				const w = Math.max(1, Math.round(img.width * scale));
				const h = Math.max(1, Math.round(img.height * scale));
				const canvas = document.createElement('canvas');
				canvas.width = w;
				canvas.height = h;
				const ctx = canvas.getContext('2d');
				if (!ctx) return reject(new Error('no-2d-context'));
				ctx.drawImage(img, 0, 0, w, h);
				resolve(canvas.toDataURL('image/webp', QUALITY));
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('image-load-failed'));
			};
			img.src = url;
		});
	}
</script>

<div class="flex items-center gap-4">
	<Avatar src={preview} {name} {email} class="h-16 w-16 text-xl" />
	<div class="space-y-1.5">
		<Button variant="secondary" type="button" onclick={() => inputEl?.click()} {disabled}>
			Change photo
		</Button>
		<p class="text-xs text-muted">PNG, JPG or WebP — resized to {MAX_DIM}px square.</p>
		{#if error}<p class="text-xs text-blocked" role="alert">{error}</p>{/if}
	</div>
	<input
		bind:this={inputEl}
		type="file"
		accept="image/png,image/jpeg,image/webp"
		class="sr-only"
		onchange={onPick}
		{disabled}
		tabindex="-1"
		aria-hidden="true"
	/>
	<input type="hidden" name="image" value={picked ?? ''} />
</div>
