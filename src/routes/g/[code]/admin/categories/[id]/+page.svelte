<script lang="ts">
	import { plural } from '#lib/format.ts';
	let { data, form } = $props();
	const c = $derived(data.category);
	let options = $state(data.options.map((o) => ({ ...o, key: `o${o.id}` })));
	let n = 0;
	const add = (kind: 'tier' | 'extra') =>
		options.push({ id: 0, label: '', points: kind === 'tier' ? 1 : 0.5, kind, key: `n${n++}` });
</script>

<a class="muted small" href="/g/{data.game.code}/admin/categories">← Categories</a>
<h1 style="margin-top:6px">Edit category</h1>

<form method="POST" action="?/save" class="stack">
	<div class="card stack">
		<label>Name <input name="name" defaultValue={c.name} required maxlength="80" /></label>
		<label>Rules and details <textarea name="rules">{c.rules}</textarea></label>
		<label>Other notes <textarea name="notes" style="min-height:56px">{c.notes}</textarea></label>
		<label>Day or group label (optional) <input name="day_label" defaultValue={c.day_label} maxlength="40" placeholder="e.g. Day 2" /></label>
		<label class="check"><input type="checkbox" name="active" checked={!!c.active} /> Show on the board</label>
	</div>

	<div class="card stack">
		<h2 style="margin:0">Scoring</h2>
		<p class="muted small" style="margin:0">
			A <strong>base</strong> line is what a photo is worth; with several, the player picks one (e.g. “Color match — 2”, “Color and texture — 3”).
			An <strong>extra</strong> is added per item, and the player says how many (e.g. “Each additional person — 0.5”).
		</p>
		{#each options as o, i (o.key)}
			<div class="opt">
				<input type="hidden" name="opt_id" value={o.id} />
				<input name="opt_label" bind:value={o.label} placeholder="What it's for" aria-label="Label" maxlength="120" />
				<input name="opt_points" bind:value={o.points} inputmode="decimal" aria-label="Points" />
				<select name="opt_kind" bind:value={o.kind} aria-label="Kind">
					<option value="tier">base</option>
					<option value="extra">extra, each</option>
				</select>
				<button type="button" class="sm danger" onclick={() => options.splice(i, 1)} aria-label="Remove">✕</button>
			</div>
		{/each}
		<div class="row">
			<button type="button" class="sm" onclick={() => add('tier')}>+ Base line</button>
			<button type="button" class="sm" onclick={() => add('extra')}>+ Extra</button>
		</div>
		<label>How many photos per team can score here? (empty for no limit)
			<input name="scoring_cap" type="number" min="1" defaultValue={c.scoring_cap ?? ''} /></label>
		<p class="muted small" style="margin:0">With a limit, a team's highest-scoring photos count. All photos can still win votes.</p>
	</div>

	{#if form?.error}<p class="err">{form.error}</p>{/if}
	<button class="primary">Save category</button>
</form>

<details class="card" style="margin-top:14px">
	<summary class="err">Delete this category</summary>
	<form method="POST" action="?/delete" class="stack" style="margin-top:12px"
		onsubmit={(e) => { if (!confirm('Delete this category and its photos?')) e.preventDefault(); }}>
		<p class="small">This also deletes its {plural(data.photos, 'photo')}. To just take it off the board, untick “Show on the board” instead.</p>
		<button class="danger">Delete category</button>
	</form>
</details>

<style>
	.opt { display: grid; grid-template-columns: 72px 1fr auto; gap: 6px; align-items: center; }
	.opt :global(input[name='opt_label']) { grid-column: 1 / -1; }
	.opt :global(input), .opt :global(select) { padding: 9px 8px; }
</style>
