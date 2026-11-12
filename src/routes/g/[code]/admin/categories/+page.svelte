<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	const base = $derived(`/g/${data.game.code}/admin/categories`);
</script>

<h1>Categories</h1>
<p class="muted small">This order is the order on the board.</p>

<div class="card" style="padding:4px 12px">
	{#each data.categories as c, i}
		<div class="spread" style="padding:8px 0;border-bottom:1px solid var(--line)">
			<a class="grow" href="{base}/{c.id}" style="text-decoration:none">
				<strong class:muted={!c.active}>{c.name}</strong>
				{#if !c.active}<span class="pill">hidden</span>{/if}
				<div class="muted small">{c.scoring ?? 'no scoring'} pts{c.day_label ? ` · ${c.day_label}` : ''} · {c.photos} photos</div>
			</a>
			<form method="POST" action="?/move" class="row" style="gap:4px" use:enhance>
				<input type="hidden" name="id" value={c.id} />
				<button class="sm" name="dir" value="up" disabled={i === 0} aria-label="Move up">↑</button>
				<button class="sm" name="dir" value="down" disabled={i === data.categories.length - 1} aria-label="Move down">↓</button>
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
