<script lang="ts">
	import { tv } from '#lib/colors.ts';
	import { enhance } from '$app/forms';
	import { pts, plural } from '#lib/format.ts';
	import PhotoEditor from '#lib/components/PhotoEditor.svelte';
	let { data, form } = $props();
	const p = $derived(data.photo);
	const base = $derived(`/g/${data.game.code}`);
	const canDoubt = $derived(!data.ours && !!data.team && p.status !== 'disqualified');
</script>

<a class="muted small" href="{base}/c/{p.category_id}">← {p.category}</a>

{#if data.isNew}<p class="card ok" style="margin-top:8px">Got it! Your photo is in.</p>{/if}

<div class="frame" style="{tv(p.color)}">
	<a href="/media/{p.id}/original" target="_blank" rel="noopener"><img src="/media/{p.id}/large" alt={p.caption || p.category} style="aspect-ratio:{p.width}/{p.height}" /></a>
</div>

<div class="card stack" style="{tv(p.color)}">
	<div class="spread">
		<span class="pill team">{p.who} · {p.team}</span>
		<span class="muted small">{new Date(p.created_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
	</div>
	{#if p.caption}<p style="margin:0">{p.caption}</p>{/if}

	<div>
		{#each data.claims as c}
			<div class="spread small"><span>{c.label}{c.qty !== 1 ? ` × ${c.qty}` : ''}</span><span>{pts(c.points * c.qty)}</span></div>
		{/each}
		{#if data.override != null}
			<div class="spread small"><span>Set by the showrunner</span><span>{pts(data.override)}</span></div>
		{/if}
		<div class="spread" style="margin-top:4px">
			<strong>
				{#if p.status === 'disqualified'}Disqualified
				{:else if p.status === 'review'}Under review — no points for now
				{:else if data.score.pending}Awaiting points from the showrunner
				{:else if !data.score.counted}Over this category's scoring limit
				{:else}Points{/if}
			</strong>
			<strong>{pts(data.score.points)}{#if !data.score.counted && p.status !== 'disqualified'} <span class="muted small">(claims {pts(data.score.claimed)})</span>{/if}</strong>
		</div>
		{#each data.grants as g}
			<div class="spread small"><span>🏅 {g.title}</span><span>+{pts(g.points)}</span></div>
		{/each}
	</div>
</div>

{#if form?.error}<p class="err">{form.error}</p>{/if}

{#if p.status === 'review'}
	<div class="card stack">
		<h2 style="margin:0">⚠️ Under review</h2>
		<p class="muted small" style="margin:0">{plural(data.doubts, 'player')} doubted this. Does it deserve its points? The showrunner makes the final call.</p>
		<form method="POST" action="?/review" class="row" use:enhance>
			<button name="agree" value="1" class="grow" class:primary={data.review.mine === 1}>👍 It counts ({data.review.agree})</button>
			<button name="agree" value="0" class="grow" class:primary={data.review.mine === 0}>👎 It doesn't ({data.review.disagree})</button>
		</form>
	</div>
{/if}

{#if canDoubt}
	<form method="POST" action="?/doubt" class="row" style="margin-bottom:14px" use:enhance>
		<input type="hidden" name="on" value={data.doubted ? '0' : '1'} />
		<button class="sm">{data.doubted ? '↩ Take back my doubt' : '🤨 Doubt this'}</button>
		<span class="muted small">{data.doubts} of {data.game.doubt_limit + 1} doubts needed for a review</span>
	</form>
{/if}

{#if data.mine || data.isAdmin}
	<details class="card">
		<summary>Edit photo</summary>
		<div class="stack" style="margin-top:12px">
			<PhotoEditor photo={p} code={data.game.code} options={data.options} claims={data.claims} categories={data.categories} canScore={data.isAdmin} />
		</div>
	</details>
{/if}

{#if data.isAdmin}
	<div class="card stack">
		<h2 style="margin:0">Showrunner</h2>
		<form method="POST" action="?/settle" class="row" use:enhance>
			{#if p.status !== 'ok'}<button name="to" value="ok" class="grow">✓ {p.status === 'review' ? 'Approve' : 'Restore'}</button>{/if}
			{#if p.status !== 'disqualified'}<button name="to" value="disqualified" class="grow danger">✖ Disqualify</button>{/if}
		</form>
		<form method="POST" action="?/adjust" class="stack" use:enhance>
			<label>Set points yourself (leave empty to use the options chosen above)
				<input name="points" inputmode="decimal" defaultValue={data.override ?? ''} placeholder={pts(data.score.claimed)} /></label>
			<button>Save</button>
		</form>
		<a class="btn" href="{base}/admin/awards?photo={p.id}#pencil">🏅 Pencil in an award for this photo</a>
	</div>
{/if}

<style>
	.frame { margin: 10px 0 14px; border-radius: 16px; overflow: hidden; border: 4px solid var(--team); background: #000; }
	.frame img { display: block; width: 100%; height: auto; max-height: 75vh; object-fit: contain; }
</style>
