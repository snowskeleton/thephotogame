import { tick } from 'svelte';

/**
 * Drag-to-reorder for a vertical list, using pointer events so it works with a mouse and with a finger.
 * Put `use:reorder` on the list, mark each row `data-row` and its grab handle `data-handle` (the handle should have
 * `touch-action: none`). Rows must be keyed in the {#each} so their elements survive a reorder.
 * While dragging, `move(from, to)` is called each time the row passes a neighbor; `done()` once, on drop.
 */
export function reorder(list: HTMLElement, opts: { move: (from: number, to: number) => void; done: () => void }) {
	let o = opts;
	let row: HTMLElement | null = null;
	let grab = 0;
	let busy = false;

	const rows = () => [...list.querySelectorAll<HTMLElement>(':scope > [data-row]')];
	const top = (e: PointerEvent) => e.clientY - list.getBoundingClientRect().top - grab;

	function down(e: PointerEvent) {
		const handle = (e.target as HTMLElement).closest('[data-handle]');
		const r = handle?.closest<HTMLElement>('[data-row]');
		if (!handle || !r || (e.pointerType === 'mouse' && e.button !== 0)) return;
		e.preventDefault();
		row = r;
		grab = e.clientY - r.getBoundingClientRect().top;
		handle.setPointerCapture(e.pointerId);
		r.dataset.dragging = '';
		r.style.position = 'relative';
		r.style.zIndex = '5';
	}

	async function move(e: PointerEvent) {
		if (!row || busy) return;
		busy = true;
		try {
			// Scroll the page when the pointer nears an edge, so a long list can be dragged all the way.
			if (e.clientY < 70) window.scrollBy(0, -12);
			else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
			for (;;) {
				const all = rows();
				const i = all.indexOf(row);
				const mid = top(e) + row.offsetHeight / 2;
				const above = all[i - 1];
				const below = all[i + 1];
				if (above && mid < above.offsetTop + above.offsetHeight / 2) o.move(i, i - 1);
				else if (below && mid > below.offsetTop + below.offsetHeight / 2) o.move(i, i + 1);
				else break;
				await tick();
			}
			row.style.transform = `translateY(${top(e) - row.offsetTop}px)`;
		} finally {
			busy = false;
		}
	}

	function up() {
		if (!row) return;
		row.style.transform = '';
		row.style.position = '';
		row.style.zIndex = '';
		delete row.dataset.dragging;
		row = null;
		o.done();
	}

	list.addEventListener('pointerdown', down);
	list.addEventListener('pointermove', move);
	list.addEventListener('pointerup', up);
	list.addEventListener('pointercancel', up);
	return {
		update(next: typeof opts) {
			o = next;
		},
		destroy() {
			list.removeEventListener('pointerdown', down);
			list.removeEventListener('pointermove', move);
			list.removeEventListener('pointerup', up);
			list.removeEventListener('pointercancel', up);
		}
	};
}
