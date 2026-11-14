<script lang="ts">
	import ColorPicker from '#lib/components/ColorPicker.svelte';
	import CopyLink from '#lib/components/CopyLink.svelte';
	import { tv } from '#lib/colors.ts';
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	const max = $derived(data.game.max_team_size);
	const unassigned = $derived(data.players.filter((p) => !p.team_id).length);
	const confirmDel = (msg: string) => (e: SubmitEvent) => { if (!confirm(msg)) e.preventDefault(); };
</script>

<h1>Teams &amp; players</h1>
<p class="muted small">
	{data.game.team_mode === 'self' ? 'Players pick their own team.' : 'You assign teams.'}
	{max ? `Max team size: ${max}.` : 'No size limit.'} Change this under Game.
</p>
{#if form?.error}<p class="err">{form.error}</p>{/if}

{#if form?.signin}
	<div class="card stack" style="border-color:var(--accent);border-width:2px">
		<h2 style="margin:0">Sign-in for {form.signin.name}</h2>
		<img src={form.signin.qr} alt="Sign-in QR code" style="width:220px;margin:0 auto;border-radius:12px" />
		<CopyLink value={form.signin.link} label="Sign-in link" shareText={`Sign in to The Photo Game as ${form.signin.name}`} />
		<p class="muted small" style="margin:0">Scan it with their phone or send them the link. Works once, for 24 hours.</p>
	</div>
{/if}

{#each data.teams as t}
	<details class="card" style="{tv(t.color)};border-left:8px solid var(--team)">
		<summary>
			{t.name}
			<span class="muted small">{t.members}{max ? `/${max}` : ''} players · {t.photos} photos</span>
			{#if max && t.members > max}<span class="pill warn">oversized</span>{/if}
		</summary>
		<form method="POST" action="?/saveTeam" class="stack" style="margin-top:12px" use:enhance>
			<input type="hidden" name="id" value={t.id} />
			<label>Name <input name="name" value={t.name} required maxlength="40" /></label>
			<ColorPicker value={t.color} taken={data.teams.map((x) => x.color)} />
			<button>Save team</button>
		</form>
		<form method="POST" action="?/deleteTeam" style="margin-top:8px" onsubmit={confirmDel('Delete this team?')}>
			<input type="hidden" name="id" value={t.id} />
			<button class="sm danger">Delete team</button>
		</form>
	</details>
{/each}

<details class="card" open={data.teams.length === 0}>
	<summary>Add a team</summary>
	<form method="POST" action="?/addTeam" class="stack" style="margin-top:12px" use:enhance>
		<label>Name <input name="name" required maxlength="40" /></label>
		{#key data.teams.length}<ColorPicker taken={data.teams.map((t) => t.color)} />{/key}
		<button class="primary">Add team</button>
	</form>
</details>

<h2 style="margin-top:20px">Players {#if unassigned}<span class="pill warn">{unassigned} without a team</span>{/if}</h2>
<div class="card" style="padding:4px 12px">
	{#each data.players as p}
		<div class="player">
			<div class="grow">
				<strong>{p.name}</strong>
				<div class="muted small" style="overflow-wrap:anywhere">{p.email} · {p.photos} photos</div>
			</div>
			<form method="POST" action="?/assign" use:enhance>
				<input type="hidden" name="user" value={p.id} />
				<select name="team" onchange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="Team for {p.name}">
					<option value="">No team</option>
					{#each data.teams as t}<option value={t.id} selected={t.id === p.team_id}>{t.name}</option>{/each}
				</select>
			</form>
			<details class="more">
				<summary aria-label="More">⋯</summary>
				<div class="row" style="margin-top:6px">
					<form method="POST" action="?/signin" use:enhance><input type="hidden" name="user" value={p.id} /><button class="sm">Sign-in QR</button></form>
					<form method="POST" action="?/removePlayer" onsubmit={confirmDel(`Remove ${p.name} from this game? Their photos stay.`)}>
						<input type="hidden" name="user" value={p.id} /><button class="sm danger">Remove</button></form>
				</div>
			</details>
		</div>
	{:else}
		<p class="muted">Nobody has joined yet. Share the join link from the Game screen.</p>
	{/each}
</div>

<details class="card">
	<summary>Add a player yourself</summary>
	<form method="POST" action="?/addPlayer" class="stack" style="margin-top:12px" use:enhance>
		<label>Name <input name="name" maxlength="40" /></label>
		<label>Email <input name="email" type="email" required /></label>
		<p class="muted small" style="margin:0">They can then sign in with an email code, or with a sign-in QR you make for them.</p>
		<button class="primary">Add player</button>
	</form>
</details>
<p class="muted small">Edit names, emails and admin rights under <a href="/admin/users">Admin: People</a>.</p>

<style>
	.player { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
	.player:last-child { border-bottom: 0; }
	.player select { width: 130px; padding: 8px; }
	.more { flex-basis: auto; }
	.more[open] { flex-basis: 100%; }
	.more summary { list-style: none; padding: 4px 8px; }
</style>
