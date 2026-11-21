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

{#if data.nav}
	<div class="spread small" style="gap:8px">
		<a class="muted" href={data.nav.back}>← Gallery{data.nav.label ? `: ${data.nav.label}` : ''}</a>
		<span class="muted">{data.nav.index ? `${data.nav.index} / ` : ''}{data.nav.total}</span>
	</div>
{:else}
	<a class="muted small" href="{base}/c/{p.category_id}">← {p.category}</a>
{/if}

{#if data.isNew}<p class="card ok" style="margin-top:8px">Got it! Your photo is in.</p>{/if}

<div class="frame" style="{tv(p.color)}">
	<a href="/media/{p.id}/original" target="_blank" rel="noopener"><img src="/media/{p.id}/large" alt={p.caption || p.category} style="aspect-ratio:{p.width}/{p.height}" /></a>
</div>

{#if data.nav && (data.nav.prev || data.nav.next)}
	<div class="row" style="margin-bottom:10px;flex-wrap:nowrap">
		{#if data.nav.prev}<a class="btn grow" href={data.nav.prev} data-sveltekit-replacestate>← Newer</a>{:else}<span class="grow"></span>{/if}
		{#if data.nav.next}<a class="btn grow" href={data.nav.next} data-sveltekit-replacestate>Older →</a>{:else}<span class="grow"></span>{/if}
	</div>
{/if}

<div class="card stack" style="{tv(p.color)}">
	<div class="spread">
		<span class="pill team">{p.who} · {p.team}</span>
		<span class="muted small">{new Date(p.created_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
	</div>
	{#if p.caption}<p style="margin:0">{p.caption}</p>{/if}
	<div class="row small" style="gap:12px">
		<a href="{base}/gallery?user={p.user_id}">All from {p.who}</a>
		<a href="{base}/gallery?team={p.team_id}">All from {p.team}</a>
	</div>

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
				{:else if data.score.pending}Awaiting points from the host
				{:else if !data.score.counted}Over this category's scoring limit
				{:else}Points{/if}
			</strong>
			<strong>{pts(data.score.points)}{#if !data.score.counted && p.status !== 'disqualified'} <span class="muted small">(claims {pts(data.score.claimed)})</span>{/if}</strong>
		</div>
		{#each data.grants as g}
			<div class="spread small"><span>🏅 {g.team}: {g.title}</span>
				<span class="row" style="gap:8px;flex-wrap:nowrap">
					{g.points >= 0 ? '+' : ''}{pts(g.points)}
					{#if data.isHost}
						<form method="POST" action="?/removeCredit" use:enhance onsubmit={(e) => { if (!confirm(`Remove ${g.team}'s points from this photo?`)) e.preventDefault(); }}>
							<input type="hidden" name="id" value={g.id} />
							<button class="sm danger" aria-label="Remove these points">✕</button>
						</form>
					{/if}
				</span></div>
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

{#if data.mine || data.isHost}
	<details class="card">
		<summary>Edit photo</summary>
		<div class="stack" style="margin-top:12px">
			<PhotoEditor photo={p} code={data.game.code} options={data.options} claims={data.claims} categories={data.categories} canScore={data.isHost} context={data.nav?.context ?? ''} />
		</div>
	</details>
{/if}

{#if data.isHost}
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
		{#if data.otherTeams.length}
			<form method="POST" action="?/give" class="stack" use:enhance={() => async ({ update, formElement }) => { await update(); formElement.reset(); }}>
				<strong>Give other teams points for this photo</strong>
				<fieldset class="stack" style="border:0;padding:0;margin:0;gap:4px">
					<legend class="small muted" style="padding:0">Teams (pick any number)</legend>
					{#each data.otherTeams as t}
						<label class="check"><input type="checkbox" name="team" value={t.id} /> <span class="grow">{t.name}</span></label>
					{/each}
				</fieldset>
				<label>Points each (negative takes points away) <input name="points" inputmode="decimal" value="1" /></label>
				<label>Reason <input name="title" required maxlength="80" value="Also in the photo" /></label>
				{#if form?.giveError}<p class="err small" style="margin:0">{form.giveError}</p>{/if}
				{#if form?.gave}<p class="ok small" style="margin:0">Points given.</p>{/if}
				<button>Give points</button>
			</form>
		{/if}
		<a class="btn" href="{base}/admin/awards?photo={p.id}#pencil">🏅 Pencil in an award for this photo</a>
	</div>
{/if}

<style>
	.frame { margin: 10px 0 14px; border-radius: 16px; overflow: hidden; border: 4px solid var(--team); background: #000; }
	.frame img { display: block; width: 100%; height: auto; max-height: 75vh; object-fit: contain; }
</style>
