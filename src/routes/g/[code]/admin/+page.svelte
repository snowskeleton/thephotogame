<script lang="ts">
	import CopyLink from '#lib/components/CopyLink.svelte';
	import DownloadAll from '#lib/components/DownloadAll.svelte';
	import { enhance } from '$app/forms';
	import { plural } from '#lib/format.ts';
	let { data, form } = $props();
	const g = $derived(data.game);
	// svelte-ignore state_referenced_locally
	let bingo = $state(!!data.game.bingo);
</script>

<h1>Game settings</h1>

{#if g.visibility === 'hidden'}
	<div class="card stack">
		<h2 style="margin:0">Nightly reveal</h2>
		<p class="muted small" style="margin:0">
			{data.stats.hidden
				? `${plural(data.stats.hidden, 'photo')} uploaded since the last reveal. Teams can only see their own until you reveal.`
				: 'Everything uploaded so far is revealed.'}
			{#if g.revealed_at}<br />Last reveal: {new Date(g.revealed_at).toLocaleString()}{/if}
		</p>
		<div class="row">
			<form method="POST" action="?/reveal" class="grow" use:enhance><button class="primary block" disabled={!data.stats.hidden}>🎉 Reveal everything so far</button></form>
			{#if g.revealed_at}<form method="POST" action="?/unreveal" use:enhance><button class="sm">Hide all again</button></form>{/if}
		</div>
	</div>
{/if}

<div class="card stack">
	<h2 style="margin:0">Invite players</h2>
	<img src={data.qr} alt="Join QR code" style="width:200px;border-radius:12px;margin:0 auto" />
	<CopyLink value={data.link} label="Join link" shareTitle={g.name} shareText={`Join “${g.name}” on The Photo Game`} />
	<CopyLink value={g.code} label="Game code" shareTitle={g.name} />
</div>

<form method="POST" action="?/save" class="card stack" use:enhance>
	<label>Name <input name="name" defaultValue={g.name} required maxlength="80" /></label>
	<label>Join code <input name="code" defaultValue={g.code} required maxlength="20" autocapitalize="characters" /></label>

	<label>Who can see photos?
		<select name="visibility">
			<option value="hidden" selected={g.visibility === 'hidden'}>Teams see only their own until I reveal</option>
			<option value="open" selected={g.visibility === 'open'}>Everyone sees everything right away</option>
		</select>
	</label>
	<label class="check"><input type="checkbox" name="submissions_open" checked={!!g.submissions_open} /> Submissions are open</label>

	<hr />
	<label>Teams
		<select name="team_mode">
			<option value="admin" selected={g.team_mode === 'admin'}>I assign everyone to a team</option>
			<option value="self" selected={g.team_mode === 'self'}>Players pick or create their own team</option>
		</select>
	</label>
	<label>Max team size (empty for no limit)
		<input name="max_team_size" type="number" min="1" defaultValue={g.max_team_size ?? ''} /></label>
	<p class="muted small" style="margin:0">Players can't join a full team. You still can add more; it's just flagged as oversized.</p>

	<hr />
	<label>Doubts allowed before a photo goes to review
		<input name="doubt_limit" type="number" min="0" defaultValue={g.doubt_limit} /></label>
	<p class="muted small" style="margin:0">With 2, a photo goes under review when a third player doubts it.</p>

	<hr />
	<label class="check"><input type="checkbox" name="bingo" bind:checked={bingo} /> Bingo board with bonus points</label>
	{#if bingo}
		<label>Columns on the board <input name="bingo_cols" type="number" min="2" max="8" defaultValue={g.bingo_cols} /></label>
		<label>Points per completed line <input name="bingo_line_points" inputmode="decimal" defaultValue={g.bingo_line_points} /></label>
		<label>Points for the whole board <input name="bingo_board_points" inputmode="decimal" defaultValue={g.bingo_board_points} /></label>
		<p class="muted small" style="margin:0">Lines are full rows and columns, plus diagonals when the board is a perfect square. Board order follows the category order.</p>
	{:else}
		<input type="hidden" name="bingo_cols" value={g.bingo_cols} />
		<input type="hidden" name="bingo_line_points" value={g.bingo_line_points} />
		<input type="hidden" name="bingo_board_points" value={g.bingo_board_points} />
	{/if}

	{#if form?.error}<p class="err">{form.error}</p>{/if}
	{#if form?.saved}<p class="ok">Saved.</p>{/if}
	<button class="primary">Save settings</button>
</form>

<div class="card stack">
	<h2 style="margin:0">Keep the photos</h2>
	<p class="muted small" style="margin:0">A zip of all {plural(data.stats.photos, 'original photo')}, in a folder per category.</p>
	<DownloadAll code={g.code} />
</div>

<details class="card">
	<summary class="err">Delete this game</summary>
	<form method="POST" action="?/deleteGame" class="stack" style="margin-top:12px">
		<p class="small">This deletes the game, its teams, categories, votes and every photo. It can't be undone. Type <strong>{g.code}</strong> to confirm.</p>
		<input name="confirm" autocomplete="off" />
		<button class="danger">Delete game forever</button>
	</form>
</details>
