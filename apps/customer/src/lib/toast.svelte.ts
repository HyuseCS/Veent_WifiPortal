type ToastType = 'success' | 'error';

interface Toast {
	id: number;
	message: string;
	type: ToastType;
}

/**
 * Tiny in-memory toast store. Kept dependency-free to honour the
 * ultra-lightweight customer portal. Read `toasts.items` in a component and
 * call `toasts.show(...)` from anywhere (e.g. a form-action `enhance` callback).
 */
class ToastStore {
	items = $state<Toast[]>([]);
	#nextId = 0;

	show(message: string, type: ToastType = 'success', durationMs = 4000) {
		const id = this.#nextId++;
		this.items.push({ id, message, type });
		setTimeout(() => this.dismiss(id), durationMs);
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastStore();
