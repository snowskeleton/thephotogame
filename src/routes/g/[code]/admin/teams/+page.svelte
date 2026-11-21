<script lang="ts">
	import ColorPicker from '#lib/components/ColorPicker.svelte';
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
{#if form?.error && form.pointsTeam == null}<p class="err">{form.error}</p>{/if}

{#if form?.invited}
	<p class="ok">
		Invite sent to {form.invited}. They’re in once they accept it.
		{#if form.logged}<span class="muted">(Email isn’t set up on this site yet, so it only went to the server log.)</span>{/if}
	</p>
{/if}

{#each data.teams as t (t.id)}
	<details class="card" style="{tv(t.color)};border-left:8px solid var(--team)">
		<summary>
			{t.name}
			<span class="muted small">{t.members}{max ? `/${max}` : ''} players · {t.photos} photos</span>
			{#if max && t.members > max}<span class="pill warn">oversized</span>{/if}
		</summary>
		<form method="POST" action="?/saveTeam" class="stack" style="margin-top:12px" use:enhance>
			<input type="hidden" name="id" value={t.id} />
			<label>Name <input name="name" defaultValue={t.name} required maxlength="40" /></label>
			<ColorPicker value={t.color} taken={data.teams.map((x) => x.color)} />
			<button>Save team</button>
		</form>
		<form method="POST" action="?/givePoints" class="stack" style="margin-top:12px" use:enhance={() => async ({ update, formElement }) => { await update(); formElement.reset(); }}>
			<input type="hidden" name="team" value={t.id} />
			<strong>Give {t.name} points</strong>
			<div class="row" style="flex-wrap:nowrap">
				<label class="grow">Reason <input name="title" required maxlength="80" placeholder="Also in Levi’s photo" /></label>
				<label style="width:90px">Points <input name="points" inputmode="decimal" value="1" /></label>
			</div>
			{#if form?.pointsTeam === t.id && form?.error}<p class="err small" style="margin:0">{form.error}</p>{/if}
			{#if form?.given === t.id}<p class="ok small" style="margin:0">Points given. See them under Awards.</p>{/if}
			<button>Give points</button>
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
	{#each data.players as p (p.id)}
		<div class="player">
			<div class="grow">
				<strong>{p.name}</strong>
				{#if p.role === 'host'}<span class="pill">host</span>{/if}
				{#if p.status === 'invited'}<span class="pill warn">invited</span>{/if}
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
					{#if p.status === 'invited'}
						<form method="POST" action="?/resend" use:enhance><input type="hidden" name="user" value={p.id} /><button class="sm">Resend invite</button></form>
					{:else}
						<form method="POST" action="?/setRole" use:enhance>
							<input type="hidden" name="user" value={p.id} />
							<input type="hidden" name="role" value={p.role === 'host' ? 'player' : 'host'} />
							<button class="sm">{p.role === 'host' ? 'Make a player' : 'Make a host'}</button>
						</form>
					{/if}
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
	<summary>Invite someone by email</summary>
	<form method="POST" action="?/addPlayer" class="stack" style="margin-top:12px" use:enhance>
		<label>Name <input name="name" maxlength="40" /></label>
		<label>Email <input name="email" type="email" required /></label>
		<p class="muted small" style="margin:0">
			We email them a link. Accepting it signs them in and helps them save a passkey. Hosts can run the game with you;
			make someone a host from the ⋯ menu once they’ve joined.
		</p>
		{#if data.invitesLeft < 999}
			<p class="muted small" style="margin:0">
				{data.invitesLeft} of {data.invitesPerDay} invites left today. The join link and QR code on the Game screen have no limit.
			</p>
		{/if}
		<button class="primary" disabled={data.invitesLeft === 0}>Send invite</button>
	</form>
</details>
{#if data.user?.is_admin}<p class="muted small">Edit names and emails under <a href="/admin/users">Site admin: People</a>.</p>{/if}

<style>
	.player { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
	.player:last-child { border-bottom: 0; }
	.player select { width: 130px; padding: 8px; }
	.more { flex-basis: auto; }
	.more[open] { flex-basis: 100%; }
	.more summary { list-style: none; padding: 4px 8px; }
</style>
