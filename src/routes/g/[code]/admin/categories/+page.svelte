<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { reorder } from '#lib/reorder.ts';
	let { data, form } = $props();
	const base = $derived(`/g/${data.game.code}/admin/categories`);

	// A working copy that follows the finger while dragging; it resets to the server's order after each load.
	let items = $state<typeof data.categories>([]);
	let dragStart = '';
	let saveError = $state('');
	$effect(() => {
		items = [...data.categories];
	});
	const ids = () => JSON.stringify(items.map((c) => c.id));

	function move(from: number, to: number) {
		if (!dragStart) dragStart = JSON.stringify(data.categories.map((c) => c.id));
		const next = [...items];
		next.splice(to, 0, next.splice(from, 1)[0]);
		items = next;
	}
	async function done() {
		const start = dragStart;
		dragStart = '';
		if (!start || ids() === start) return;
		saveError = '';
		const body = new FormData();
		body.set('ids', ids());
		try {
			const res = await fetch('?/reorder', { method: 'POST', body, headers: { accept: 'application/json', 'x-sveltekit-action': 'true' } });
			if (deserialize(await res.text()).type !== 'success') throw new Error('not saved');
		} catch {
			saveError = 'Couldn’t save the new order. It was put back.';
		}
		await invalidateAll();
	}
</script>

<h1>Categories</h1>
<p class="muted small">This order is the order on the board. Drag the handle to reorder, or use the arrows.</p>
{#if saveError}<p class="err small">{saveError}</p>{/if}

<div class="card list" style="padding:4px 12px" use:reorder={{ move, done }}>
	{#each items as c, i (c.id)}
		<div class="spread row-item" data-row data-category={c.name} style="padding:8px 0;border-bottom:1px solid var(--line)">
			<span class="handle" data-handle role="img" aria-label="Drag to reorder">⠿</span>
			<a class="grow" href="{base}/{c.id}" style="text-decoration:none">
				<strong class:muted={!c.active}>{c.name}</strong>
				{#if !c.active}<span class="pill">hidden</span>{/if}
				<div class="muted small">{c.scoring ?? 'no scoring'} pts{c.day_label ? ` · ${c.day_label}` : ''} · {c.photos} photos</div>
			</a>
			<form method="POST" action="?/move" class="row" style="gap:4px" use:enhance>
				<input type="hidden" name="id" value={c.id} />
				<button class="sm" name="dir" value="up" disabled={i === 0} aria-label="Move up">↑</button>
				<button class="sm" name="dir" value="down" disabled={i === items.length - 1} aria-label="Move down">↓</button>
			</form>
		</div>
	{:else}
		<p class="muted">No categories yet. Add the first one below.</p>
	{/each}
</div>

<form method="POST" action="?/add" class="card stack" use:enhance>
	<h2 style="margin:0">Add a category</h2>
	<label>Name <input name="name" required maxlength="80" /></label>
	<label>Points <input name="points" inputmode="decimal" value="1" /></label>
	{#if form?.error}<p class="err">{form.error}</p>{/if}
	<div class="row">
		<button class="grow">Add</button>
		<button class="primary grow" name="then" value="edit">Add &amp; set up details</button>
	</div>
	<p class="muted small" style="margin:0">Rules, point tiers, extras and limits are on the details screen.</p>
</form>

<style>
	.list { position: relative; }
	.row-item { background: var(--card); }
	:global(.row-item[data-dragging]) { box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); border-radius: 10px; opacity: 0.95; }
	.handle {
		flex: none; width: 34px; align-self: stretch; display: grid; place-items: center; font-size: 1.3rem;
		color: var(--muted, #888); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
	}
	:global(.row-item[data-dragging]) .handle { cursor: grabbing; }
</style>
