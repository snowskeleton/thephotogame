<script lang="ts">
	import { page } from '$app/state';
	import { plural } from '#lib/format.ts';
	import Thumb from '#lib/components/Thumb.svelte';
	let { data } = $props();
	let formEl: HTMLFormElement;
	const dayName = (d: string) =>
		new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
</script>

<div class="spread">
	<h1>Gallery</h1>
	{#if data.photos.length}<a class="btn sm primary" href="/g/{data.game.code}/show{page.url.search}">▶ Slideshow</a>{/if}
</div>

<form bind:this={formEl} class="row" style="margin-bottom:12px;flex-wrap:nowrap" data-sveltekit-keepfocus>
	<select name="cat" onchange={() => formEl.requestSubmit()} aria-label="Category">
		<option value="">All categories</option>
		{#each data.categories as c}<option value={c.id} selected={data.filter.cat === c.id}>{c.name}</option>{/each}
	</select>
	<select name="team" onchange={() => formEl.requestSubmit()} aria-label="Team">
		<option value="">All teams</option>
		{#each data.teams as t}<option value={t.id} selected={data.filter.team === t.id}>{t.name}</option>{/each}
	</select>
	<select name="day" onchange={() => formEl.requestSubmit()} aria-label="Day">
		<option value="">All days</option>
		{#each data.days as d}<option value={d} selected={data.filter.day === d}>{dayName(d)}</option>{/each}
	</select>
	{#if data.isHost}
		<label class="check small" style="white-space:nowrap"><input type="checkbox" name="unscored" value="1" checked={data.filter.unscored} onchange={() => formEl.requestSubmit()} /> Unscored only</label>
	{/if}
</form>

{#if data.hiddenCount > 0}
	<p class="card muted small">🤫 {plural(data.hiddenCount, 'photo')} from other teams {data.hiddenCount === 1 ? 'is' : 'are'} hidden until the showrunner reveals them.</p>
{/if}

{#if data.photos.length}
	<div class="photos">
		{#each data.photos as p}<Thumb photo={p} code={data.game.code} showScore={data.isHost} />{/each}
	</div>
{:else}
	<p class="muted">No photos here yet.</p>
{/if}
