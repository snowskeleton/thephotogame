<script lang="ts">
	import { page } from '$app/state';
	import { plural } from '#lib/format.ts';
	import Thumb from '#lib/components/Thumb.svelte';
	import { fromGallery } from '#lib/browse.ts';
	import { galleryMemory } from '#lib/galleryMemory.svelte.ts';
	let { data } = $props();
	let formEl: HTMLFormElement;
	const ctx = $derived(fromGallery(page.url.search));
	const filtered = $derived(page.url.search.length > 1);
	// The Gallery tab returns here with these filters, even after visiting a photo or another screen.
	$effect(() => galleryMemory.set(data.game.code, page.url.search));
	const dayName = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
</script>

<div class="spread">
	<h1>Gallery</h1>
	{#if data.photos.length}<a class="btn sm primary" href="/g/{data.game.code}/show{page.url.search}">▶ Slideshow</a>{/if}
</div>

<form bind:this={formEl} class="row" style="margin-bottom:12px;flex-wrap:wrap" data-sveltekit-keepfocus>
	<select name="cat" onchange={() => { const item = formEl.elements.namedItem('item'); if (item instanceof HTMLSelectElement) item.value = ''; formEl.requestSubmit(); }} aria-label="Category">
		<option value="">All categories</option>
		{#each data.categories as c}<option value={c.id} selected={data.filter.cat === c.id}>{c.name}</option>{/each}
	</select>
	{#if data.items.length}
		<select name="item" onchange={() => formEl.requestSubmit()} aria-label="Checklist item">
			<option value="">All items</option>
			{#each data.items as i}<option value={i.id} selected={data.filter.item === i.id}>{i.label}</option>{/each}
		</select>
	{/if}
	<select name="team" onchange={() => formEl.requestSubmit()} aria-label="Team">
		<option value="">All teams</option>
		{#each data.teams as t}<option value={t.id} selected={data.filter.team === t.id}>{t.name}</option>{/each}
	</select>
	<select name="user" onchange={() => formEl.requestSubmit()} aria-label="Person">
		<option value="">All people</option>
		{#each data.people as u}<option value={u.id} selected={data.filter.user === u.id}>{u.name}</option>{/each}
	</select>
	<select name="day" onchange={() => formEl.requestSubmit()} aria-label="Day">
		<option value="">All days</option>
		{#each data.days as d}<option value={d} selected={data.filter.day === d}>{dayName(d)}</option>{/each}
	</select>
	{#if data.isHost}
		<label class="check small" style="white-space:nowrap"><input type="checkbox" name="unscored" value="1" checked={data.filter.unscored} onchange={() => formEl.requestSubmit()} /> Unscored only</label>
	{/if}
</form>

{#if filtered}
	<p class="muted small" style="margin:0 0 10px">
		{plural(data.photos.length, 'photo')}
		<a href="/g/{data.game.code}/gallery" onclick={() => galleryMemory.set(data.game.code, '')}>Clear filters</a>
	</p>
{/if}

{#if data.hiddenCount > 0}
	<p class="card muted small">🤫 {plural(data.hiddenCount, 'photo')} from other teams {data.hiddenCount === 1 ? 'is' : 'are'} hidden until the showrunner reveals them.</p>
{/if}

{#if data.photos.length}
	<div class="photos">
		{#each data.photos as p}<Thumb photo={p} code={data.game.code} showScore={data.isHost} context={ctx} />{/each}
	</div>
{:else}
	<p class="muted">No photos here yet.</p>
{/if}
