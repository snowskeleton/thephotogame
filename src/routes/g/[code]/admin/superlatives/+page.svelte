<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let kind = $state<'person' | 'team' | 'photo'>(data.preset ? 'photo' : 'person');
	const confirmDel = (e: SubmitEvent) => { if (!confirm('Delete this superlative?')) e.preventDefault(); };
	const label = (s: (typeof data.items)[number]) =>
		s.kind === 'photo' ? `Photo by ${s.who} (${s.team})` : s.kind === 'team' ? `Team ${s.who}` : `${s.who}${s.team ? ` (${s.team})` : ''}`;
</script>

<h1>Superlatives</h1>
<p class="muted small">
	Make up a title and give it to a player, a team or a photo: “Most likely to nap”, “Best photobomb”. Players see them on the Scores page.
	They carry no points; use Awards for that. Each new one is also sent to the game’s webhooks.
</p>

<details class="card" open>
	<summary>Give a superlative</summary>
	<form method="POST" action="?/add" class="stack" style="margin-top:12px" use:enhance={() => async ({ update }) => update({ reset: true })}>
		<label>Superlative <input name="title" required maxlength="80" placeholder="Most likely to nap" /></label>
		<label>Goes to
			<select name="kind" bind:value={kind}>
				<option value="person">A player</option>
				<option value="team">A team</option>
				<option value="photo">A photo</option>
			</select>
		</label>
		{#if kind === 'person'}
			<label>Player
				<select name="person" required>
					<option value="">Choose…</option>
					{#each data.players as p}<option value={p.id}>{p.name}{p.team ? ` (${p.team})` : ''}</option>{/each}
				</select>
			</label>
		{:else if kind === 'team'}
			<label>Team
				<select name="team" required>
					<option value="">Choose…</option>
					{#each data.teams as t}<option value={t.id}>{t.name}</option>{/each}
				</select>
			</label>
		{:else}
			<label>Photo
				<select name="photo" required>
					<option value="">Choose…</option>
					{#each data.photos as p}<option value={p.id} selected={p.id === data.preset}>#{p.id} {p.who}, {p.category}{p.caption ? `: ${p.caption.slice(0, 30)}` : ''}</option>{/each}
				</select>
			</label>
		{/if}
		<label>Note (optional) <input name="note" maxlength="300" /></label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary">Give it</button>
	</form>
</details>

{#each data.items as s (s.id)}
	<div class="card stack">
		<div class="spread">
			<strong>🏆 {s.title}</strong>
			<span class="pill">{s.kind === 'person' ? 'Player' : s.kind === 'team' ? 'Team' : 'Photo'}</span>
		</div>
		<div class="small">{label(s)}{#if s.photo_id} · <a href="/g/{data.game.code}/p/{s.photo_id}">view</a>{/if}</div>
		{#if s.note}<div class="muted small">{s.note}</div>{/if}
		<form method="POST" action="?/delete" onsubmit={confirmDel} use:enhance>
			<input type="hidden" name="id" value={s.id} />
			<button class="sm danger">Delete</button>
		</form>
	</div>
{:else}
	<p class="muted">None yet.</p>
{/each}
