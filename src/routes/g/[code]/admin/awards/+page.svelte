<script lang="ts">
	import { tv } from '#lib/colors.ts';
	import { enhance } from '$app/forms';
	import { pts, plural } from '#lib/format.ts';
	let { data, form } = $props();
	let team = $state<number | ''>(data.preset?.team_id ?? '');
	let user = $state<number | ''>(data.preset?.user_id ?? '');
	let picked = $state<number[]>(data.preset ? [data.preset.id] : []);
	let allTeams = $state(false);
	const pickable = $derived(data.photos.filter((p) => allTeams || !team || p.team_id === team || picked.includes(p.id)));
	const people = $derived(data.players.filter((p) => !team || p.team_id === team));
	const confirmDel = (what: string) => (e: SubmitEvent) => { if (!confirm(`Delete ${what}?`)) e.preventDefault(); };
</script>

<h1>Awards</h1>

<h2>Voted awards</h2>
<p class="muted small">Players vote for as many photos as they like. When you close voting, the photo with the most votes wins the points for its team (ties all win).</p>

{#each data.awards as a}
	<div class="card stack">
		<div class="spread">
			<strong>{a.name}</strong>
			<span class="pill" class:warn={a.status === 'open'}>{a.status === 'draft' ? 'Not started' : a.status === 'open' ? 'Voting open' : 'Closed'}</span>
		</div>
		<div class="muted small">
			+{pts(a.points)} pts · {a.scope === 'category' ? 'winner in every category' : 'one winner overall'} · {plural(a.voters, 'voter')}
		</div>
		<form method="POST" action="?/status" class="row" use:enhance>
			<input type="hidden" name="id" value={a.id} />
			{#if a.status !== 'open'}<button class="sm primary" name="to" value="open">{a.status === 'closed' ? 'Reopen voting' : 'Open voting'}</button>{/if}
			{#if a.status === 'open'}<button class="sm primary" name="to" value="closed">Close voting &amp; show results</button>{/if}
			{#if a.status !== 'draft'}<button class="sm" name="to" value="draft">Hide from players</button>{/if}
			<a class="btn sm" href="/g/{data.game.code}/vote/{a.id}">View</a>
		</form>
		<details>
			<summary class="small">Edit</summary>
			<form method="POST" action="?/saveAward" class="stack" style="margin-top:10px" use:enhance>
				<input type="hidden" name="id" value={a.id} />
				<label>Name <input name="name" value={a.name} required maxlength="80" /></label>
				<label>Description <input name="description" value={a.description} maxlength="400" /></label>
				<label>Bonus points <input name="points" inputmode="decimal" value={a.points} /></label>
				<label>Winners
					<select name="scope">
						<option value="game" selected={a.scope === 'game'}>One winner across all photos</option>
						<option value="category" selected={a.scope === 'category'}>A winner in every category</option>
					</select>
				</label>
				<button>Save</button>
			</form>
			<form method="POST" action="?/deleteAward" style="margin-top:8px" onsubmit={confirmDel('this award and its votes')}>
				<input type="hidden" name="id" value={a.id} />
				<button class="sm danger">Delete award</button>
			</form>
		</details>
	</div>
{/each}

<details class="card" open={data.awards.length === 0}>
	<summary>Add a voted award</summary>
	<form method="POST" action="?/addAward" class="stack" style="margin-top:12px" use:enhance>
		<label>Name <input name="name" required maxlength="80" placeholder="Crowd favorite" /></label>
		<label>Description <input name="description" maxlength="400" /></label>
		<label>Bonus points <input name="points" inputmode="decimal" value="3" /></label>
		<label>Winners
			<select name="scope">
				<option value="game">One winner across all photos</option>
				<option value="category">A winner in every category</option>
			</select>
		</label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary">Add award</button>
	</form>
</details>

<h2 id="pencil" style="margin-top:22px">Pencil in an award</h2>
<p class="muted small">Give points for anything, any time: one photo, a set of photos, or no photo at all.</p>

<form method="POST" action="?/grant" class="card stack"
	use:enhance={() => async ({ update, result }) => { await update(); if (result.type === 'success') picked = []; }}>
	<label>Title <input name="title" required maxlength="80" placeholder="Best dad joke at dinner" /></label>
	<div class="row" style="flex-wrap:nowrap">
		<label class="grow">Points <input name="points" inputmode="decimal" value="1" /></label>
		<label class="grow">Team
			<select name="team" bind:value={team} required>
				<option value="">Choose…</option>
				{#each data.teams as t}<option value={t.id}>{t.name}</option>{/each}
			</select>
		</label>
	</div>
	<label>Credit a person (optional)
		<select name="user" bind:value={user}>
			<option value="">The whole team</option>
			{#each people as p}<option value={p.id}>{p.name}</option>{/each}
		</select>
	</label>
	<label>Note (optional) <input name="note" maxlength="400" /></label>

	<details open={picked.length > 0}>
		<summary>Attach photos{picked.length ? ` (${picked.length})` : ' (optional)'}</summary>
		<label class="check small" style="margin:8px 0"><input type="checkbox" bind:checked={allTeams} /> Show every team's photos</label>
		<div class="photos">
			{#each pickable as p (p.id)}
				<label class="ph" style="{tv(p.color)};cursor:pointer" class:sel={picked.includes(p.id)} title={p.category}>
					<input type="checkbox" name="photos" value={p.id} bind:group={picked} hidden />
					<img src="/media/{p.id}/thumb" alt={p.category} loading="lazy" />
					{#if picked.includes(p.id)}<span class="tag">✓ attached</span>{/if}
				</label>
			{:else}
				<p class="muted small">No photos{team ? ' from this team' : ''} yet.</p>
			{/each}
		</div>
	</details>
	{#if form?.grantError}<p class="err">{form.grantError}</p>{/if}
	{#if form?.granted}<p class="ok">Award given.</p>{/if}
	<button class="primary">Give award</button>
</form>

{#each data.grants as g}
	<div class="card spread" style="{tv(g.color)}">
		<div class="grow">
			<strong>🏅 {g.title}</strong> <span class="pill">{g.points >= 0 ? '+' : ''}{pts(g.points)}</span>
			<div class="small"><span class="pill team">{g.who ? `${g.who} · ` : ''}{g.team}</span>
				{#if g.photos}<span class="muted"> {plural(g.photos, 'photo')}</span>{/if}</div>
			{#if g.note}<div class="muted small">{g.note}</div>{/if}
		</div>
		<form method="POST" action="?/deleteGrant" onsubmit={confirmDel('this award')}>
			<input type="hidden" name="id" value={g.id} />
			<button class="sm danger" aria-label="Delete">✕</button>
		</form>
	</div>
{/each}

<style>
	.sel { outline: 4px solid var(--good); outline-offset: -1px; }
</style>
