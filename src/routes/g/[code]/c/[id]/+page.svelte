<script lang="ts">
	import { enhance } from '$app/forms';
	import { pts, plural } from '#lib/format.ts';
	import Thumb from '#lib/components/Thumb.svelte';
	import ClaimFields from '#lib/components/ClaimFields.svelte';
	let { data, form } = $props();
	let busy = $state(false);
	let picked = $state(0);
	const open = $derived(data.game.submissions_open && data.category.active);
</script>

<a class="muted small" href="/g/{data.game.code}">← Board</a>
<h1 style="margin-top:6px">{data.category.name}</h1>
{#if data.category.day_label}<p><span class="pill">{data.category.day_label}</span></p>{/if}

<div class="card stack">
	{#if data.category.rules}<p style="white-space:pre-wrap;margin:0">{data.category.rules}</p>{/if}
	{#if data.options.length}
		<div>
			{#each data.options as o}
				<div class="spread small" style="padding:3px 0">
					<span>{o.label}</span>
					<strong>{o.kind === 'extra' ? '+' : ''}{pts(o.points)} pt{o.kind === 'extra' ? ' each' : ''}</strong>
				</div>
			{/each}
		</div>
	{/if}
	{#if data.category.scoring_cap}
		<p class="muted small" style="margin:0">Only your team's best {plural(data.category.scoring_cap, 'photo')} here score points. Every photo can still win votes.</p>
	{/if}
	{#if data.category.notes}<p class="muted small" style="white-space:pre-wrap;margin:0">{data.category.notes}</p>{/if}
</div>

{#if data.team && open}
	<form method="POST" enctype="multipart/form-data" class="card stack" style="border-color:var(--team);border-width:2px"
		use:enhance={() => { busy = true; return async ({ update }) => { await update(); busy = false; }; }}>
		<h2 style="margin:0">Add a photo</h2>
		<label class="btn team block">
			{picked ? `${plural(picked, 'photo')} chosen — tap to change` : '📷 Take or choose a photo'}
			<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" multiple required hidden
				onchange={(e) => (picked = e.currentTarget.files?.length ?? 0)} />
		</label>
		<ClaimFields options={data.options} />
		<label>Caption (optional) <input name="caption" maxlength="200" /></label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary" disabled={busy || !picked}>{busy ? 'Uploading…' : 'Submit'}</button>
	</form>
{:else if !open}
	<p class="muted">Submissions are closed.</p>
{/if}

{#if data.ours.length}
	<h2>Your team's photos</h2>
	<div class="photos" style="margin-bottom:16px">
		{#each data.ours as p}
			<Thumb photo={p} code={data.game.code} tag={p.score.counted ? `${pts(p.score.points)} pt` : p.status === 'ok' ? 'extra' : ''} />
		{/each}
	</div>
{/if}
{#if data.theirs.length}
	<h2>Other teams</h2>
	<div class="photos">
		{#each data.theirs as p}<Thumb photo={p} code={data.game.code} />{/each}
	</div>
{/if}
