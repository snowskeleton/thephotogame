<script lang="ts">
	import { pts, plural } from '#lib/format.ts';
	import { tv } from '#lib/colors.ts';
	import Thumb from '#lib/components/Thumb.svelte';
	import ClaimFields from '#lib/components/ClaimFields.svelte';
	import Uploader from '#lib/components/Uploader.svelte';
	import PhotoEditor from '#lib/components/PhotoEditor.svelte';
	let { data, form } = $props();
	const open = $derived(data.game.submissions_open && data.category.active);
	const canEdit = (p: { user_id: number }) => p.user_id === data.user?.id || data.isHost;
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
	<div class="card stack" style="border-color:var(--team);border-width:2px">
		<h2 style="margin:0">Add photos here</h2>
		<Uploader>
			{#snippet fields()}
				{#if data.isHost}<ClaimFields options={data.options} />{/if}
				<label>Caption (optional) <input name="caption" maxlength="200" /></label>
			{/snippet}
		</Uploader>
		{#if form?.error}<p class="err" style="margin:0">{form.error}</p>{/if}
		{#if form?.added}<p class="ok" style="margin:0">{plural(form.added, 'photo')} added.</p>{/if}
	</div>
{:else if !data.team}
	<p class="muted">Join a team on the <a href="/g/{data.game.code}">board</a> to submit photos.</p>
{:else}
	<p class="muted">Submissions are closed.</p>
{/if}

{#if data.ours.length}
	<h2>Your team's photos</h2>
	<div class="stack" style="margin-bottom:16px;gap:10px">
		{#each data.ours as p (p.id)}
			<div class="card ourrow" style="{tv(p.color)}">
				<div class="row" style="flex-wrap:nowrap">
					<div class="ourthumb"><Thumb photo={p} code={data.game.code} /></div>
					<div class="grow">
						<strong>{p.who}</strong>
						{#if p.caption}<div class="small">{p.caption}</div>{/if}
						<div class="muted small">
							{#if p.status === 'disqualified'}Disqualified
							{:else if p.status === 'review'}Under review
							{:else if p.score.pending}Awaiting points
							{:else if p.score.counted}{pts(p.score.points)} pt
							{:else}Over the scoring limit{/if}
						</div>
					</div>
				</div>
				{#if canEdit(p)}
					<details>
						<summary>Edit</summary>
						<div class="stack" style="margin-top:10px">
							<PhotoEditor photo={p} code={data.game.code} options={data.options} claims={p.claims} categories={data.categories} canScore={data.isHost} />
						</div>
					</details>
				{/if}
			</div>
		{/each}
	</div>
{/if}
{#if data.theirs.length}
	<h2>Other teams</h2>
	<div class="photos">
		{#each data.theirs as p}<Thumb photo={p} code={data.game.code} />{/each}
	</div>
{/if}

<style>
	.ourrow { padding: 10px; margin: 0; display: grid; gap: 8px; }
	.ourthumb { width: 84px; flex: none; }
	summary { cursor: pointer; font-weight: 600; }
</style>
